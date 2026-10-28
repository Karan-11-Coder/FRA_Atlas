"""
fra_ml.py: shared setup for the ml/notebooks modelling notebooks (02-05).

Keeps the split, baselines, metrics and pipeline construction identical
across notebooks. Feature engineering itself lives in
fra-atlas/backend/services/ml_features.py, so the saved model and the
backend's inference code use the exact same transformation.

Usage from a notebook in ml/notebooks/:
    import sys; sys.path.insert(0, "..")
    from fra_ml import *
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

ROOT = Path(__file__).resolve().parent.parent           # repo root
ML_DIR = ROOT / "ml"
DATA_PATH = ML_DIR / "data" / "labeled_dataset.csv"
RESULTS_DIR = ML_DIR / "results"
ARTIFACTS_DIR = ML_DIR / "artifacts"

if str(ROOT / "fra-atlas") not in sys.path:
    sys.path.insert(0, str(ROOT / "fra-atlas"))
from backend.services.ml_features import (  # noqa: E402
    ABLATION_EXTRA, CLAIM_TYPES, MODEL_FEATURES, RAW_FEATURES, add_engineered_features,
)

SEED = 42
TARGETS = ["pm_kisan_score", "mgnrega_score", "jjm_score", "pmfby_score", "pmksy_score", "soil_health_card_score"]
PRIMARY = ["mgnrega_score", "pmksy_score", "soil_health_card_score"]
SIDE = ["jjm_score", "pmfby_score", "pm_kisan_score"]
SHORT = {t: t.replace("_score", "") for t in TARGETS}
# R^2 ceilings from backend/services/check_labels.py
CEILING = {"pm_kisan_score": 0.975, "soil_health_card_score": 0.922, "pmksy_score": 0.917,
           "jjm_score": 0.846, "pmfby_score": 0.627, "mgnrega_score": 0.583}
# A CV/test R^2 this far above the oracle R^2 on the same rows is treated as
# leakage, not luck.
LEAK_TOLERANCE = 0.02
N_FOLDS = 5


class _NoNoise:
    """Stand-in for random.Random whose gauss() returns the mean: the rule's noiseless score."""
    def gauss(self, mu, sd):
        return mu


def rule_signal(df: pd.DataFrame) -> pd.DataFrame:
    """
    The noiseless rule score for every row and target, from scheme_rules.py.
    is_scheduled_area is True for every row (dropped from ml/data because it
    is constant).
    """
    from backend.services.scheme_rules import SCORERS
    recs = df.assign(is_scheduled_area=True).to_dict("records")
    return pd.DataFrame([{t: fn(r, _NoNoise()) for t, fn in SCORERS.items()} for r in recs], index=df.index)


def oracle_r2(df: pd.DataFrame, target: str) -> float:
    """
    R^2 of the noiseless rule on exactly these rows: the best any model can
    score on them. The published CEILING is the population value; a given
    split can sit above or below it (e.g. a test set rich in extreme-climate
    districts has more signal variance), so leakage is judged against this.
    """
    return r2_score(df[target], rule_signal(df)[target])


def load_data() -> pd.DataFrame:
    df = pd.read_csv(DATA_PATH)
    df["soil_imputed"] = df["soil_ph_imputed"] | df["soil_organic_carbon_imputed"]
    return df


def split(df: pd.DataFrame, test_size: float = 0.2):
    """The one held-out test split: whole spatial_blocks, seed 42."""
    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=SEED)
    tr, te = next(gss.split(df, groups=df["spatial_block"]))
    return df.iloc[tr].reset_index(drop=True), df.iloc[te].reset_index(drop=True)


def group_cv():
    """GroupKFold on spatial_block; pass groups=train['spatial_block'] when using it."""
    return GroupKFold(n_splits=N_FOLDS)


def make_pipe(model, features=None, scale=True) -> Pipeline:
    """engineer features -> select + (optionally) standardize -> model."""
    features = list(features or MODEL_FEATURES)
    pre = ColumnTransformer([("num", StandardScaler() if scale else "passthrough", features)])
    return Pipeline([
        ("engineer", FunctionTransformer(add_engineered_features)),
        ("select", pre),
        ("model", model),
    ])


def X_of(df: pd.DataFrame, extra=()) -> pd.DataFrame:
    """Raw model inputs (what the DSS will pass at inference time)."""
    return df[RAW_FEATURES + list(extra)]


def metrics(y, p) -> dict:
    return {"MAE": mean_absolute_error(y, p),
            "RMSE": float(np.sqrt(mean_squared_error(y, p))),
            "R2": r2_score(y, p)}


def bootstrap_ci(y, p, fn=r2_score, n=1000, seed=SEED, alpha=0.05):
    """Percentile bootstrap CI of fn(y, p) by resampling test rows."""
    y, p = np.asarray(y), np.asarray(p)
    rng = np.random.default_rng(seed)
    stats = [fn(y[i], p[i]) for i in (rng.integers(0, len(y), len(y)) for _ in range(n))]
    lo, hi = np.quantile(stats, [alpha / 2, 1 - alpha / 2])
    return float(lo), float(hi)


def baseline_predictions(train: pd.DataFrame, test: pd.DataFrame, target: str) -> dict:
    """Test-set predictions of the three reference baselines, fit on train only."""
    overall = train[target].mean()
    out = {"baseline: training mean": np.full(len(test), overall)}
    for key, name in [("district", "baseline: per-district mean"), ("claim_type", "baseline: per-claim_type mean")]:
        means = train.groupby(key)[target].mean()
        out[name] = test[key].map(means).fillna(overall).to_numpy()
    return out


def baseline_cv_predictions(train: pd.DataFrame, target: str) -> dict:
    """Out-of-fold (GroupKFold) predictions of the same baselines on train."""
    out = {k: np.zeros(len(train)) for k in
           ["baseline: training mean", "baseline: per-district mean", "baseline: per-claim_type mean"]}
    for tr, va in group_cv().split(train, groups=train["spatial_block"]):
        preds = baseline_predictions(train.iloc[tr], train.iloc[va], target)
        for k in out:
            out[k][va] = preds[k]
    return out


def evaluate(pipe, train, test, target, name, extra=()) -> tuple[dict, np.ndarray]:
    """
    Fit on train, report train / GroupKFold-CV / test metrics and a bootstrap
    95% CI for test R^2. Returns (row, test_predictions). The pipe passed in
    is left fitted on the full training split.
    """
    Xtr, Xte = X_of(train, extra), X_of(test, extra)
    cv_pred = cross_val_predict(pipe, Xtr, train[target], cv=group_cv(), groups=train["spatial_block"])
    pipe.fit(Xtr, train[target])
    tr_pred, te_pred = pipe.predict(Xtr), pipe.predict(Xte)
    row = {"target": target, "model": name}
    for split_name, y, p in [("train", train[target], tr_pred), ("cv", train[target], cv_pred), ("test", test[target], te_pred)]:
        for k, v in metrics(y, p).items():
            row[f"{split_name}_{k}"] = v
    lo, hi = bootstrap_ci(test[target], te_pred)
    row.update({"test_R2_ci_low": lo, "test_R2_ci_high": hi})
    _add_ceiling_cols(row, train, test, target)
    return row, te_pred


def _add_ceiling_cols(row, train, test, target):
    row["ceiling"] = CEILING[target]
    row["cv_oracle_R2"] = oracle_r2(train, target)
    row["test_oracle_R2"] = oracle_r2(test, target)
    row["pct_of_ceiling_cv"] = row["cv_R2"] / CEILING[target]
    row["test_pct_of_oracle"] = row["test_R2"] / row["test_oracle_R2"]
    row["leak_flag"] = bool(row["cv_R2"] > row["cv_oracle_R2"] + LEAK_TOLERANCE
                            or row["test_R2"] > row["test_oracle_R2"] + LEAK_TOLERANCE)


def baseline_rows(train, test, target) -> list[dict]:
    rows = []
    cv = baseline_cv_predictions(train, target)
    te = baseline_predictions(train, test, target)
    tr = baseline_predictions(train, train, target)
    for name in te:
        row = {"target": target, "model": name}
        for split_name, y, p in [("train", train[target], tr[name]), ("cv", train[target], cv[name]), ("test", test[target], te[name])]:
            for k, v in metrics(y, p).items():
                row[f"{split_name}_{k}"] = v
        lo, hi = bootstrap_ci(test[target], te[name])
        row.update({"test_R2_ci_low": lo, "test_R2_ci_high": hi})
        _add_ceiling_cols(row, train, test, target)
        rows.append(row)
    return rows
