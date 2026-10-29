"""
ml_inference.py

Scores a claim for the six schemes with the trained models in
ml/artifacts/model.joblib (built by ml/notebooks/02_regression.ipynb).

The scores reproduce RULE-DERIVED labels (backend/services/scheme_rules.py
plus noise). They are suitability indicators, not eligibility decisions.

A claim only carries lat/lon, land area and claim type, so the remaining
model inputs are resolved here, without calling SoilGrids live (60+ s):
  district            point-in-polygon against the 7 training districts;
                      anything outside them is refused (the models don't
                      transfer to unseen districts)
  groundwater/rainfall district constants from reference_datasheets.py
  soil pH / OC        nearest dataset plot with a real (non-imputed) reading
                      within SOIL_NEIGHBOUR_KM, else the district mean of
                      real readings (ml/artifacts/feature_schema.json)
Every resolved input is reported as estimated, with its source.

Paths can be overridden with ML_MODEL_PATH, ML_SCHEMA_PATH, ML_REFERENCE_DATA
and DISTRICT_GEOJSON_DIR.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from shapely.geometry import Point, shape

from backend.services.ml_features import CLAIM_TYPES, RAW_FEATURES
from backend.services.reference_datasheets import GROUNDWATER_STRESS_PCT, RAINFALL_MM
from backend.services.sample_geography import DISTRICT_FILES

logger = logging.getLogger(__name__)

_FRA_ATLAS_DIR = Path(__file__).resolve().parents[2]      # fra-atlas/
_REPO_ROOT = _FRA_ATLAS_DIR.parent

MODEL_PATH = Path(os.getenv("ML_MODEL_PATH", _REPO_ROOT / "ml" / "artifacts" / "model.joblib"))
# Every model from notebooks 02-04, for the lab (ml/export_dashboard.py).
ALL_MODELS_PATH = Path(os.getenv("ML_ALL_MODELS_PATH", _REPO_ROOT / "ml" / "artifacts" / "all_models.joblib"))
SCHEMA_PATH = Path(os.getenv("ML_SCHEMA_PATH", _REPO_ROOT / "ml" / "artifacts" / "feature_schema.json"))
REFERENCE_DATA_PATH = Path(os.getenv("ML_REFERENCE_DATA", _REPO_ROOT / "ml" / "data" / "labeled_dataset.csv"))
DISTRICT_GEOJSON_DIR = Path(os.getenv("DISTRICT_GEOJSON_DIR", _FRA_ATLAS_DIR / "UI_FRA" / "public" / "geojson" / "districts"))

# Median nearest-neighbour spacing in the dataset is ~2.2 km; beyond 5 km a
# neighbour's soil reading says little about this plot.
SOIL_NEIGHBOUR_KM = 5.0
# Samples per input when estimating how much each input moves a score.
CONTRIBUTION_SAMPLES = 100
# Only list inputs that move a score by at least this many points. Smaller
# effects are well inside the models' typical error (3-5 pts), and are where
# district-proxy effects show up (e.g. pH nudging JJM, whose rule ignores pH).
MIN_REPORTED_EFFECT = 2.0

SCHEME_LABELS = {
    "pm_kisan_score": "PM-KISAN",
    "mgnrega_score": "MGNREGA",
    "jjm_score": "JJM",
    "pmfby_score": "PMFBY",
    "pmksy_score": "PMKSY",
    "soil_health_card_score": "Soil Health Card",
}
INPUT_LABELS = {
    "land_area_ha": "Land area",
    "claim_type": "Claim type",
    "soil_ph": "Soil pH",
    "soil_organic_carbon": "Soil organic carbon",
    "groundwater_stress_pct": "Groundwater stress",
    "rainfall_mm_avg": "Rainfall",
}
DISCLAIMER = "Rule-derived suitability, not an eligibility decision."


class ModelUnavailable(RuntimeError):
    """The model artifact (or its reference data) couldn't be loaded."""


class InputError(ValueError):
    """The claim can't be scored as given (missing or out-of-scope input)."""


_state: Dict[str, Any] = {}


def load(force: bool = False) -> bool:
    """Load the model bundle and reference data once. Returns False (and logs) on failure."""
    if _state.get("loaded") and not force:
        return True
    _state.clear()
    try:
        import joblib
        bundle = joblib.load(MODEL_PATH)
        schema = json.loads(SCHEMA_PATH.read_text())
        ref = pd.read_csv(REFERENCE_DATA_PATH)
        polygons = {}
        for (state, district), fname in DISTRICT_FILES.items():
            gj = json.loads((DISTRICT_GEOJSON_DIR / fname).read_text())
            polygons[(state, district)] = shape(gj["features"][0]["geometry"])
    except Exception as e:  # missing file, unpickling error, version mismatch, ...
        _state["error"] = f"{type(e).__name__}: {e}"
        logger.warning("ML model not loaded (%s); /api/diagnostics will return 503", _state["error"])
        return False

    _state.update(bundle=bundle, schema=schema, ref=ref, polygons=polygons, loaded=True,
                  ranges={f["name"]: f["range"] for f in schema["raw_features"] if "range" in f})
    logger.info("ML model loaded from %s (%s)", MODEL_PATH, bundle.get("model_names"))
    try:
        import joblib
        _state["all_models"] = joblib.load(ALL_MODELS_PATH)
    except Exception as e:
        _state["all_models_error"] = f"{type(e).__name__}: {e}"
        logger.warning("All-models bundle not loaded (%s); lab live routes will return 503", _state["all_models_error"])
    return True


def status() -> Dict[str, Any]:
    if not _state.get("loaded"):
        return {"loaded": False, "error": _state.get("error", "not loaded"), "model_path": str(MODEL_PATH)}
    b = _state["bundle"]
    return {"loaded": True, "models": b["model_names"], "sklearn_version": b["sklearn_version"],
            "training_districts": b["training_districts"]}


def _require_loaded():
    if not _state.get("loaded") and not load():
        raise ModelUnavailable(_state.get("error", "model not loaded"))


def _haversine_km(lat, lon, lats, lons):
    lat, lon, lats, lons = map(np.radians, (lat, lon, lats, lons))
    a = np.sin((lats - lat) / 2) ** 2 + np.cos(lat) * np.cos(lats) * np.sin((lons - lon) / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(a))


def find_district(lat: float, lon: float) -> Optional[tuple]:
    _require_loaded()
    p = Point(lon, lat)
    for key, poly in _state["polygons"].items():
        if poly.contains(p):
            return key
    return None


def _soil_value(col: str, lat: float, lon: float, state: str, district: str) -> tuple:
    """(value, source) for a soil column: nearest real reading within cutoff, else district mean."""
    ref = _state["ref"]
    real = ref[(ref.district == district) & ~ref[f"{col}_imputed"].astype(bool)]
    if len(real):
        d = _haversine_km(lat, lon, real.lat.to_numpy(), real.lon.to_numpy())
        i = int(np.argmin(d))
        if d[i] <= SOIL_NEIGHBOUR_KM:
            return float(real[col].iloc[i]), f"nearest SoilGrids reading in the dataset ({d[i]:.1f} km away)"
    mean = _state["schema"]["districts"][district][f"{col}_mean"]
    return float(mean), f"{district} district mean of real SoilGrids readings (no reading within {SOIL_NEIGHBOUR_KM:g} km)"


def resolve_inputs(lat: Optional[float], lon: Optional[float], land_area_ha: Optional[float],
                   claim_type: Optional[str]) -> Dict[str, Any]:
    """Build the model's raw inputs for a claim, recording where each came from."""
    _require_loaded()
    missing = [n for n, v in [("lat", lat), ("lon", lon), ("land_area", land_area_ha), ("claim_type", claim_type)] if v in (None, "")]
    if missing:
        raise InputError(f"Missing {', '.join(missing)}; the claim needs coordinates, land area and claim type to be scored.")
    claim_type = str(claim_type).upper()
    if claim_type not in CLAIM_TYPES:
        raise InputError(f"claim_type must be one of {list(CLAIM_TYPES)}")
    lat, lon, land_area_ha = float(lat), float(lon), float(land_area_ha)
    if land_area_ha <= 0:
        raise InputError("land_area must be positive")

    found = find_district(lat, lon)
    if not found:
        raise InputError("Location is outside the 7 districts the model was trained on ("
                         + ", ".join(_state["bundle"]["training_districts"]) + "); it cannot be scored reliably.")
    state, district = found

    sources: Dict[str, str] = {}
    notes: List[str] = []
    lo, hi = _state["ranges"]["land_area_ha"]
    if not lo <= land_area_ha <= hi:
        notes.append(f"Land area {land_area_ha:g} ha is outside the training range ({lo:g}-{hi:g} ha); scored as {min(max(land_area_ha, lo), hi):g} ha.")
        land_area_ha = min(max(land_area_ha, lo), hi)

    values = {"land_area_ha": land_area_ha, "claim_type": claim_type}
    for col in ("soil_ph", "soil_organic_carbon"):
        values[col], sources[col] = _soil_value(col, lat, lon, state, district)
    values["groundwater_stress_pct"] = float(GROUNDWATER_STRESS_PCT[(state, district)])
    values["rainfall_mm_avg"] = float(RAINFALL_MM[(state, district)])
    for col in ("groundwater_stress_pct", "rainfall_mm_avg"):
        sources[col] = f"{district} district reference value (reference_datasheets.py; regional estimate)"

    return {"state": state, "district": district, "values": values, "sources": sources, "notes": notes}


def _contributions(model, row: pd.DataFrame, pred: float, seed: int = 0) -> Dict[str, float]:
    """
    How much each input moves this score: the prediction minus the average
    prediction when that one input is swapped for values drawn from the
    training data (other inputs held fixed). Positive = pushes the score up.
    """
    ref = _state["ref"]
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(ref), CONTRIBUTION_SAMPLES)
    blocks = []
    for f in RAW_FEATURES:
        b = pd.concat([row] * CONTRIBUTION_SAMPLES, ignore_index=True)
        b[f] = ref[f].to_numpy()[idx]
        blocks.append(b)
    preds = model.predict(pd.concat(blocks, ignore_index=True)).reshape(len(RAW_FEATURES), CONTRIBUTION_SAMPLES)
    return {f: float(pred - preds[i].mean()) for i, f in enumerate(RAW_FEATURES)}


def predict_schemes(lat=None, lon=None, land_area_ha=None, claim_type=None) -> Dict[str, Any]:
    """Score one claim for all six schemes. Raises ModelUnavailable / InputError."""
    _require_loaded()
    resolved = resolve_inputs(lat, lon, land_area_ha, claim_type)
    row = pd.DataFrame([resolved["values"]])[RAW_FEATURES]
    bundle = _state["bundle"]

    schemes = []
    for target, model in bundle["models"].items():
        score = float(np.clip(model.predict(row)[0], 0, 100))
        contrib = _contributions(model, row, score)
        top = sorted(contrib.items(), key=lambda kv: abs(kv[1]), reverse=True)
        top = [(f, c) for f, c in top if abs(c) >= MIN_REPORTED_EFFECT][:3]
        m = bundle["metrics"][target]
        schemes.append({
            "key": target,
            "name": SCHEME_LABELS[target],
            "score": int(round(score)),
            "reasons": [f"{INPUT_LABELS[f]} {'raises' if c > 0 else 'lowers'} the score by {abs(c):.0f} points vs a typical plot" for f, c in top]
                       or ["No single input moves this score much; it is close to the typical plot"],
            "top_inputs": [{"input": f, "label": INPUT_LABELS[f], "effect": round(c, 1)} for f, c in top],
            "model": bundle["model_names"][target],
            "typical_error": round(m["test_MAE"], 1),
            "test_r2": round(m["test_R2"], 3),
        })
    schemes.sort(key=lambda s: s["score"], reverse=True)

    estimated = [{"input": k, "label": INPUT_LABELS[k], "value": resolved["values"][k], "source": v}
                 for k, v in resolved["sources"].items()]
    return {
        "state": resolved["state"],
        "district": resolved["district"],
        "inputs": resolved["values"],
        "estimated_inputs": estimated,
        "notes": resolved["notes"],
        "recommendations": schemes,
        "disclaimer": DISCLAIMER,
        "model_info": {"models": bundle["model_names"], "sklearn_version": bundle["sklearn_version"],
                       "labels_rule_derived": True},
    }


# =============================================================================
# Lab: every model, side by side (used by /api/lab/predict and /api/lab/sweep)
# =============================================================================
class _NoNoise:
    def gauss(self, mu, sd):
        return mu


def _require_all_models():
    _require_loaded()
    if "all_models" not in _state:
        raise ModelUnavailable(_state.get("all_models_error", "all-models bundle not loaded"))
    return _state["all_models"]


def district_defaults(district: str) -> Dict[str, Any]:
    """Typical inputs for a training district: climate constants + mean of real soil readings."""
    _require_loaded()
    d = _state["schema"]["districts"].get(district)
    if d is None:
        raise InputError(f"Unknown district '{district}'. Use one of: " + ", ".join(sorted(_state["schema"]["districts"])))
    return {"state": d["state"], "district": district,
            "values": {"land_area_ha": 1.5, "claim_type": "IFR",
                       "soil_ph": d["soil_ph_mean"], "soil_organic_carbon": d["soil_organic_carbon_mean"],
                       "groundwater_stress_pct": d["groundwater_stress_pct"], "rainfall_mm_avg": d["rainfall_mm_avg"]}}


def _check_values(values: Dict[str, Any]) -> pd.DataFrame:
    missing = [f for f in RAW_FEATURES if values.get(f) in (None, "")]
    if missing:
        raise InputError(f"Missing inputs: {', '.join(missing)}")
    row = {f: values[f] for f in RAW_FEATURES}
    row["claim_type"] = str(row["claim_type"]).upper()
    if row["claim_type"] not in CLAIM_TYPES:
        raise InputError(f"claim_type must be one of {list(CLAIM_TYPES)}")
    for f in RAW_FEATURES:
        if f != "claim_type":
            row[f] = float(row[f])
    return pd.DataFrame([row])[RAW_FEATURES]


def rule_scores(frame: pd.DataFrame) -> Dict[str, np.ndarray]:
    """Noiseless scheme_rules.py scores for each row (the 'ground truth' the models learn)."""
    from backend.services.scheme_rules import SCORERS
    recs = frame.assign(is_scheduled_area=True).to_dict("records")
    return {t: np.array([fn(r, _NoNoise()) for r in recs]) for t, fn in SCORERS.items()}


def out_of_range(values: Dict[str, Any]) -> List[str]:
    notes = []
    for f, (lo, hi) in _state["ranges"].items():
        v = values.get(f)
        if isinstance(v, (int, float)) and not lo <= float(v) <= hi:
            notes.append(f"{INPUT_LABELS.get(f, f)} {v:g} is outside the training range ({lo:g}-{hi:g}): every model is extrapolating.")
    return notes


def predict_all(values: Dict[str, Any]) -> Dict[str, Any]:
    """Scores from every model for one set of inputs, plus the noiseless rule."""
    bundle = _require_all_models()
    row = _check_values(values)
    rules = rule_scores(row)
    scores = {}
    for t in bundle["targets"]:
        scores[t] = {name: round(float(m.predict(row)[0]), 2) for name, m in bundle["models"][t].items()}
        scores[t]["rule"] = round(float(rules[t][0]), 2)
    return {"inputs": row.iloc[0].to_dict(), "scores": scores, "models": bundle["model_order"],
            "chosen": bundle["chosen"], "notes": out_of_range(values), "disclaimer": DISCLAIMER}


SWEEP_RANGES = {"claim_type": list(CLAIM_TYPES)}


def sweep(values: Dict[str, Any], feature: str, points: int = 41) -> Dict[str, Any]:
    """Vary one input across its training range (others fixed); every model's curve + the rule's."""
    bundle = _require_all_models()
    if feature not in RAW_FEATURES:
        raise InputError(f"feature must be one of {RAW_FEATURES}")
    base = _check_values(values)
    if feature == "claim_type":
        grid = SWEEP_RANGES["claim_type"]
    else:
        lo, hi = _state["ranges"][feature]
        grid = np.linspace(lo, hi, max(5, min(points, 201))).round(4).tolist()
    frame = pd.concat([base.assign(**{feature: v}) for v in grid], ignore_index=True)
    rules = rule_scores(frame)
    curves = {}
    for t in bundle["targets"]:
        curves[t] = {name: np.round(m.predict(frame), 2).tolist() for name, m in bundle["models"][t].items()}
        curves[t]["rule"] = np.round(rules[t], 2).tolist()
    return {"feature": feature, "grid": grid, "curves": curves, "current": base.iloc[0][feature],
            "models": bundle["model_order"], "chosen": bundle["chosen"]}
