"""
export_dashboard.py: build everything the ML dashboard shows.

Refits every model from notebooks 02-04 with the tuned parameters recorded in
ml/results/*.csv (same split, seed and features), then writes:

  ml/artifacts/all_models.joblib      {target: {model_name: fitted Pipeline}}
  ml/artifacts/dashboard/*.json       precomputed views (metrics, predictions,
                                      importance, partial dependence, depth
                                      curves, classification, structure,
                                      association rules, dataset, districts)

Run from the repo root:   ml/.venv/Scripts/python ml/export_dashboard.py
Takes a few minutes (leave-one-district-out refits every model 7 times).

Labels are rule-derived (scheme_rules.py + noise); every number here
describes how well models recover those rules, not real eligibility.
"""
import json
import sys
import time
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.manifold import TSNE
from sklearn.metrics import (adjusted_rand_score, confusion_matrix, r2_score, roc_auc_score, roc_curve,
                             silhouette_score)
from sklearn.model_selection import LeaveOneGroupOut, cross_val_predict, validation_curve
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler, label_binarize
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fra_ml import (ABLATION_EXTRA, ARTIFACTS_DIR, CEILING, MODEL_FEATURES, RAW_FEATURES, RESULTS_DIR, SEED,  # noqa: E402
                    SHORT, TARGETS, X_of, add_engineered_features, bootstrap_ci, group_cv, load_data, make_pipe,
                    metrics, oracle_r2, rule_signal, split)
from backend.services import scheme_rules as sr  # noqa: E402

warnings.filterwarnings("ignore", category=ConvergenceWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

OUT = ARTIFACTS_DIR / "dashboard"
MODELS = ["simple linear", "multiple linear", "decision tree", "SVR (RBF)", "random forest", "MLP"]   # simplest first
MLP_CONFIG = dict(hidden_layer_sizes=(64, 32), activation="relu", solver="adam", alpha=0.01,
                  learning_rate_init=1e-3, max_iter=800, n_iter_no_change=20, random_state=SEED)
NUMERIC_RAW = [f for f in RAW_FEATURES if f != "claim_type"]


def r(x, n=3):
    """Round floats (and nested lists/dicts of them) for compact JSON."""
    if isinstance(x, dict):
        return {k: r(v, n) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [r(v, n) for v in x]
    if isinstance(x, (np.floating, float)):
        return None if not np.isfinite(x) else round(float(x), n)
    if isinstance(x, np.integer):
        return int(x)
    return x


def dump(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(obj, separators=(",", ":")))
    print(f"  wrote {name}.json ({(OUT / f'{name}.json').stat().st_size // 1024} KB)")


def build_model(name, target, cmp):
    row = cmp[(cmp.target == target) & (cmp.model == name)]
    params = json.loads(row.params.iloc[0]) if len(row) and row.params.iloc[0].startswith("{") else {}
    if name == "simple linear":
        feature = row.params.iloc[0].split("= ")[1]
        return make_pipe(LinearRegression(), features=[feature]), {"feature": feature}
    if name == "multiple linear":
        return make_pipe(LinearRegression()), {}
    if name == "decision tree":
        return make_pipe(DecisionTreeRegressor(random_state=SEED, **params)), params
    if name == "SVR (RBF)":
        return make_pipe(SVR(kernel="rbf", **params)), params
    if name == "random forest":
        return make_pipe(RandomForestRegressor(n_estimators=200, random_state=SEED, n_jobs=-1, **params)), params
    if name == "MLP":
        return make_pipe(MLPRegressor(**MLP_CONFIG)), {k: (list(v) if isinstance(v, tuple) else v) for k, v in MLP_CONFIG.items()}
    raise ValueError(name)


def main():
    t0 = time.time()
    df = load_data()
    train, test = split(df)
    cmp = pd.read_csv(RESULTS_DIR / "model_comparison.csv")
    bundle = joblib.load(ARTIFACTS_DIR / "model.joblib")
    chosen = bundle["model_names"]
    signal_all = rule_signal(df)
    signal_test = rule_signal(test)

    # ---------------- regression: refit, metrics, predictions ----------------
    print("Fitting regression models ...")
    all_models, model_rows, test_preds, params_out = {t: {} for t in TARGETS}, [], {}, {}
    for t in TARGETS:
        for name in MODELS:
            pipe, params = build_model(name, t, cmp)
            Xtr, Xte = X_of(train), X_of(test)
            cvp = cross_val_predict(pipe, Xtr, train[t], cv=group_cv(), groups=train.spatial_block, n_jobs=-1)
            lodo = cross_val_predict(clone(pipe), X_of(df), df[t], cv=LeaveOneGroupOut(), groups=df.district, n_jobs=-1)
            pipe.fit(Xtr, train[t])
            p_tr, p_te = pipe.predict(Xtr), pipe.predict(Xte)
            lo, hi = bootstrap_ci(test[t], p_te)
            m_te, m_cv, m_tr = metrics(test[t], p_te), metrics(train[t], cvp), metrics(train[t], p_tr)
            in_notebook = bool(len(cmp[(cmp.target == t) & (cmp.model.str.startswith(name.split(" (")[0]))]))
            model_rows.append({
                "target": t, "model": name, "params": params,
                "train_R2": m_tr["R2"], "cv_R2": m_cv["R2"], "test_R2": m_te["R2"], "test_MAE": m_te["MAE"],
                "test_RMSE": m_te["RMSE"], "test_R2_ci": [lo, hi], "lodo_R2": r2_score(df[t], lodo),
                "test_oracle_R2": oracle_r2(test, t), "ceiling": CEILING[t],
                "rule_gap_MAE": float(np.mean(np.abs(p_te - signal_test[t]))),
                "chosen": chosen[t] == name or (name == "MLP" and False),
                "source": "notebook 02/04" if in_notebook else "export only (04 config applied to this target)",
            })
            all_models[t][name] = pipe
            test_preds[(t, name)] = p_te
            params_out[(t, name)] = params
            print(f"    {SHORT[t]:<17} {name:<16} cv {m_cv['R2']:.3f}  test {m_te['R2']:.3f}  lodo {model_rows[-1]['lodo_R2']:.3f}")

    baselines = []
    for _, b in cmp[cmp.model.str.startswith("baseline")].iterrows():
        baselines.append({"target": b.target, "model": b.model.replace("baseline: ", ""), "cv_R2": b.cv_R2, "test_R2": b.test_R2,
                          "test_MAE": b.test_MAE})

    joblib.dump({"models": all_models, "model_order": MODELS, "chosen": chosen, "targets": TARGETS,
                 "raw_features": RAW_FEATURES, "sklearn_version": sklearn.__version__, "labels_rule_derived": True},
                ARTIFACTS_DIR / "all_models.joblib")
    print(f"  wrote all_models.joblib ({(ARTIFACTS_DIR / 'all_models.joblib').stat().st_size // 1024} KB)")

    dump("models", {
        "targets": TARGETS, "short": SHORT, "models": MODELS, "chosen": chosen,
        "raw_features": RAW_FEATURES, "model_features": MODEL_FEATURES,
        "rows": r(model_rows), "baselines": r(baselines),
        "noise_sd": sr.NOISE_SD, "train_rows": len(train), "test_rows": len(test),
        "sklearn_version": sklearn.__version__, "seed": SEED,
    })

    dump("predictions", {
        "plot_id": test.plot_id.tolist(), "district": test.district.tolist(),
        "soil_imputed": test.soil_imputed.astype(bool).tolist(),
        "y": {t: r(test[t].tolist(), 2) for t in TARGETS},
        "rule": {t: r(signal_test[t].tolist(), 2) for t in TARGETS},
        "pred": {t: {name: r(test_preds[(t, name)].tolist(), 2) for name in MODELS} for t in TARGETS},
    })

    # ---------------- explainability ----------------
    print("Permutation importance + partial dependence ...")
    importance = {t: {} for t in TARGETS}
    pdp = {t: {} for t in TARGETS}
    grids = {f: np.linspace(train[f].min(), train[f].max(), 25) for f in NUMERIC_RAW}
    base_rows = X_of(test).reset_index(drop=True)
    for t in TARGETS:
        for name in MODELS:
            m = all_models[t][name]
            pi = permutation_importance(m, X_of(test), test[t], n_repeats=5, random_state=SEED)
            importance[t][name] = dict(zip(RAW_FEATURES, r(pi.importances_mean.tolist(), 4)))
            curves = {}
            for f in NUMERIC_RAW:
                big = pd.concat([base_rows.assign(**{f: v}) for v in grids[f]], ignore_index=True)
                curves[f] = r(m.predict(big).reshape(len(grids[f]), -1).mean(axis=1).tolist(), 2)
            big = pd.concat([base_rows.assign(claim_type=c) for c in ["IFR", "CFR", "CR"]], ignore_index=True)
            curves["claim_type"] = r(m.predict(big).reshape(3, -1).mean(axis=1).tolist(), 2)
            pdp[t][name] = curves
        # the rule itself, for reference curves
        rule_curves = {}
        for f in NUMERIC_RAW:
            rule_curves[f] = r([rule_signal(test.assign(**{f: v}))[t].mean() for v in grids[f]], 2)
        rule_curves["claim_type"] = r([rule_signal(test.assign(claim_type=c))[t].mean() for c in ["IFR", "CFR", "CR"]], 2)
        pdp[t]["rule"] = rule_curves

    # ablation: random forest with lat/lon/elevation/clay added back
    ablation = {}
    for t in TARGETS:
        rf_params = params_out[(t, "random forest")]
        feats = MODEL_FEATURES + ABLATION_EXTRA
        pipe = make_pipe(RandomForestRegressor(n_estimators=200, random_state=SEED, n_jobs=-1, **rf_params), features=feats)
        pipe.fit(X_of(train, ABLATION_EXTRA), train[t])
        cols = RAW_FEATURES + ABLATION_EXTRA
        pi = permutation_importance(pipe, X_of(test, ABLATION_EXTRA), test[t], n_repeats=5, random_state=SEED)
        lodo = cross_val_predict(clone(pipe), X_of(df, ABLATION_EXTRA), df[t], cv=LeaveOneGroupOut(), groups=df.district, n_jobs=-1)
        ablation[t] = {"importance": dict(zip(cols, r(pi.importances_mean.tolist(), 4))),
                       "test_R2": r(r2_score(test[t], pipe.predict(X_of(test, ABLATION_EXTRA)))),
                       "lodo_R2": r(r2_score(df[t], lodo))}

    rule_inputs = {
        "pm_kisan_score": ["claim_type"],
        "mgnrega_score": ["groundwater_stress_pct", "soil_ph", "soil_organic_carbon", "land_area_ha", "claim_type"],
        "jjm_score": ["rainfall_mm_avg", "groundwater_stress_pct"],
        "pmfby_score": ["rainfall_mm_avg"],
        "pmksy_score": ["groundwater_stress_pct", "rainfall_mm_avg", "land_area_ha", "claim_type", "soil_ph", "soil_organic_carbon"],
        "soil_health_card_score": ["soil_ph", "soil_organic_carbon"],
    }
    dump("explain", {"importance": importance, "pdp": pdp, "grids": r({f: g.tolist() for f, g in grids.items()}, 3),
                     "claim_types": ["IFR", "CFR", "CR"], "ablation": ablation, "rule_inputs": rule_inputs,
                     "ablation_extra": ABLATION_EXTRA})

    # ---------------- bias-variance: tree depth ----------------
    depths = [1, 2, 3, 4, 5, 6, 8, 10, 14, 20]
    depth = {}
    for t in TARGETS:
        tr_s, cv_s = validation_curve(make_pipe(DecisionTreeRegressor(random_state=SEED)), X_of(train), train[t],
                                      param_name="model__max_depth", param_range=depths, cv=group_cv(),
                                      groups=train.spatial_block, scoring="r2", n_jobs=-1)
        depth[t] = {"train": r(tr_s.mean(1).tolist()), "cv": r(cv_s.mean(1).tolist())}
    mlp_seeds = cmp[cmp.notebook == "04_neural_net"][["target", "seed_sd_test_R2", "seed_sd_cv_R2"]]
    dump("curves", {"depths": depths, "depth": depth,
                    "mlp_seed_sd": {row.target: {"test": row.seed_sd_test_R2, "cv": row.seed_sd_cv_R2} for row in mlp_seeds.itertuples()}})

    # ---------------- classification ----------------
    print("Classification ...")
    ccmp = pd.read_csv(RESULTS_DIR / "classification_comparison.csv")
    cuts = train.pmksy_score.quantile([1 / 3, 2 / 3]).to_numpy()
    classes = ["low", "medium", "high"]
    to_cls = lambda s: pd.cut(s, [-np.inf, cuts[0], cuts[1], np.inf], labels=classes).astype(str)
    y_tr, y_te = to_cls(train.pmksy_score), to_cls(test.pmksy_score)
    ctor = {
        "logistic regression": lambda p: LogisticRegression(max_iter=2000, **p),
        "KNN": lambda p: KNeighborsClassifier(**p),
        "linear SVM": lambda p: SVC(kernel="linear", probability=True, random_state=SEED, **p),
        "kernel SVM (RBF)": lambda p: SVC(kernel="rbf", probability=True, random_state=SEED, **p),
        "naive Bayes": lambda p: GaussianNB(**p),
        "decision tree": lambda p: DecisionTreeClassifier(random_state=SEED, **p),
    }
    clf_out = []
    for _, row in ccmp[ccmp.task.str.startswith("pmksy")].iterrows():
        m = make_pipe(ctor[row.model](json.loads(row.params))).fit(X_of(train), y_tr)
        proba = m.predict_proba(X_of(test)); labels = list(m.classes_)
        pred = m.predict(X_of(test))
        roc = {}
        for c in classes:
            fpr, tpr, _ = roc_curve(y_te == c, proba[:, labels.index(c)])
            idx = np.unique(np.linspace(0, len(fpr) - 1, min(60, len(fpr))).astype(int))
            roc[c] = {"fpr": r(fpr[idx].tolist()), "tpr": r(tpr[idx].tolist()),
                      "auc": r(roc_auc_score(y_te == c, proba[:, labels.index(c)]))}
        clf_out.append({
            "model": row.model, "params": json.loads(row.params),
            "cv_f1_macro": row.cv_f1_macro, "test_accuracy": row.test_accuracy,
            "test_acc_ci": [row.test_acc_ci_low, row.test_acc_ci_high], "test_f1_macro": row.test_f1_macro,
            "test_auc": row.test_auc, "confusion": confusion_matrix(y_te, pred, labels=classes).tolist(),
            "roc": roc, "p_high": r(proba[:, labels.index("high")].tolist(), 4),
        })
    sanity = ccmp[ccmp.task.str.startswith("sanity")][["model", "test_accuracy", "test_f1_macro", "test_auc"]].to_dict("records")
    dump("classification", {"classes": classes, "cuts": r(cuts.tolist(), 2), "y_test": y_te.tolist(),
                            "score_test": r(test.pmksy_score.tolist(), 2), "models": r(clf_out, 4), "sanity": r(sanity, 4)})

    # ---------------- structure: PCA, t-SNE, k-means, rules ----------------
    print("Structure (PCA, t-SNE, k-means, association rules) ...")
    E = add_engineered_features(X_of(df))
    env_cols = ["soil_ph", "oc_pct", "groundwater_stress_pct", "rainfall_mm_avg"]
    views = {"all": StandardScaler().fit_transform(E[MODEL_FEATURES]), "env": StandardScaler().fit_transform(E[env_cols])}
    pca = PCA(n_components=2, random_state=SEED).fit(views["all"])
    pc = pca.transform(views["all"])
    ts = TSNE(n_components=2, perplexity=30, random_state=SEED, init="pca").fit_transform(views["all"])
    kmeans = {}
    for vname, X in views.items():
        kmeans[vname] = {}
        for k in range(2, 11):
            km = KMeans(n_clusters=k, n_init=10, random_state=SEED).fit(X)
            kmeans[vname][str(k)] = {"labels": km.labels_.tolist(), "silhouette": r(silhouette_score(X, km.labels_)),
                                     "inertia": r(km.inertia_, 1), "ari_district": r(adjusted_rand_score(df.district, km.labels_))}
    dump("structure", {"pca": r(pc.tolist(), 3), "pca_var": r(pca.explained_variance_ratio_.tolist()),
                       "pca_loadings": dict(zip(MODEL_FEATURES, r(pca.components_.T.tolist()))),
                       "tsne": r(ts.tolist(), 2), "kmeans": kmeans, "views": {"all": MODEL_FEATURES, "env": env_cols}})

    from mlxtend.frequent_patterns import apriori, association_rules
    items = pd.DataFrame({
        "IFR": df.claim_type == "IFR", "CFR": df.claim_type == "CFR", "CR": df.claim_type == "CR",
        "small holding (<=2 ha)": E.small_holding == 1, "acidic soil (pH<6.5)": E.ph_band == 0,
        "low OC (<1.5%)": E.oc_pct < 1.5, "high OC (>2%)": E.oc_pct > 2.0,
        "dry (<1000 mm)": df.rainfall_mm_avg < 1000, "wet (>1300 mm)": df.rainfall_mm_avg > 1300,
        "high gw stress (>=55%)": df.groundwater_stress_pct >= 55,
    })
    score_items = []
    for t in TARGETS:
        q = df[t].quantile([1 / 3, 2 / 3])
        items[f"{SHORT[t]} HIGH"] = df[t] > q.iloc[1]; items[f"{SHORT[t]} LOW"] = df[t] <= q.iloc[0]
        score_items += [f"{SHORT[t]} HIGH", f"{SHORT[t]} LOW"]
    freq = apriori(items, min_support=0.05, use_colnames=True, max_len=3)
    rules = association_rules(freq, metric="confidence", min_threshold=0.6)
    rules = rules[rules.lift > 1.2].sort_values("lift", ascending=False).head(600)
    dump("assoc_rules", {"score_items": score_items, "rules": [
        {"if": sorted(a), "then": sorted(c), "support": r(s), "confidence": r(cf), "lift": r(lf)}
        for a, c, s, cf, lf in zip(rules.antecedents, rules.consequents, rules.support, rules.confidence, rules.lift)]})

    # ---------------- dataset + districts + EDA ----------------
    print("Dataset, districts, EDA ...")
    cols = ["plot_id", "state", "district", "lat", "lon", "spatial_block", "land_area_ha", "claim_type", "soil_ph",
            "soil_organic_carbon", "soil_clay_pct", "elevation_m", "groundwater_stress_pct", "rainfall_mm_avg",
            "soil_ph_imputed", "soil_organic_carbon_imputed", "elevation_m_imputed"] + TARGETS
    ds = df[cols].copy()
    ds["split"] = np.where(df.plot_id.isin(test.plot_id), "test", "train")
    for t in TARGETS:
        ds[f"rule_{t}"] = signal_all[t].round(2)
    ds = ds.round(4)
    dump("dataset", {"columns": list(ds.columns), "rows": ds.astype(object).where(ds.notna(), None).values.tolist()})

    chosen_all = {t: all_models[t][chosen[t]].predict(X_of(df)) for t in TARGETS}
    districts = []
    for (state, d), g in df.groupby(["state", "district"]):
        idx = g.index
        districts.append({
            "state": state, "district": d, "plots": len(g),
            "rainfall_mm_avg": float(g.rainfall_mm_avg.iloc[0]), "groundwater_stress_pct": float(g.groundwater_stress_pct.iloc[0]),
            "soil_ph_mean": r(g.soil_ph.mean()), "soil_oc_mean": r(g.soil_organic_carbon.mean()),
            "imputed_share": r(g.soil_imputed.mean()),
            "label_mean": {t: r(g[t].mean(), 1) for t in TARGETS},
            "pred_mean": {t: r(float(np.mean(chosen_all[t][idx])), 1) for t in TARGETS},
            "rule_mean": {t: r(signal_all.loc[idx, t].mean(), 1) for t in TARGETS},
        })
    dump("districts", {"districts": districts})

    num = ["land_area_ha", "soil_ph", "soil_organic_carbon", "soil_clay_pct", "elevation_m", "groundwater_stress_pct", "rainfall_mm_avg"]
    corr = df[num + TARGETS].corr()
    within = {}
    for t in TARGETS:
        gm = df[t].groupby(df.district).transform("mean")
        within[t] = r(1 - ((df[t] - gm) ** 2).sum() / ((df[t] - df[t].mean()) ** 2).sum())
    dump("eda", {"corr_columns": num + TARGETS, "corr": r(corr.values.tolist()), "district_r2": within,
                 "ceiling": CEILING, "imputed_share_overall": r(df.soil_imputed.mean())})

    print(f"Done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
