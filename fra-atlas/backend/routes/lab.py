# backend/routes/lab.py
"""
Model lab API for the dashboard (mounted under /api).

  GET  /lab/views/{name}         precomputed views from ml/export_dashboard.py
  GET  /lab/district-defaults/{district}
  POST /lab/resolve              lat/lon -> district + estimated inputs
  POST /lab/predict              every model's scores for one set of inputs (+ the rule)
  POST /lab/sweep                one input across its range, every model's curve (+ the rule)
  GET  /lab/rules                the scoring rules, their constants and inputs
  POST /lab/rules/cutoff         re-score the dataset with different pH / organic-carbon bands
  GET  /lab/extraction-quality   document-AI accuracy on the hand-labelled sample PDFs

All scores are rule-derived suitability on synthetic plots, not eligibility decisions.
"""
import inspect
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.services import ml_inference, scheme_rules
from backend.services.ml_features import RAW_FEATURES

router = APIRouter(prefix="/lab", tags=["lab"])

DASHBOARD_DIR = Path(os.getenv("ML_DASHBOARD_DIR", ml_inference.ALL_MODELS_PATH.parent / "dashboard"))
VIEWS = {"models", "predictions", "explain", "curves", "classification", "structure", "assoc_rules",
         "dataset", "districts", "eda"}


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ml_inference.ModelUnavailable as e:
        raise HTTPException(status_code=503, detail=f"Models unavailable: {e}")
    except ml_inference.InputError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/views/{name}")
def view(name: str):
    if name not in VIEWS:
        raise HTTPException(status_code=404, detail=f"Unknown view. Available: {sorted(VIEWS)}")
    path = DASHBOARD_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"{name}.json not built; run ml/export_dashboard.py")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "max-age=300"})


@router.get("/district-defaults/{district}")
def district_defaults(district: str):
    return _wrap(ml_inference.district_defaults, district)


class ResolveIn(BaseModel):
    lat: float
    lon: float


@router.post("/resolve")
def resolve(body: ResolveIn):
    """District + estimated soil/climate for a map point (soil from the nearest real reading, else district mean)."""
    r = _wrap(ml_inference.resolve_inputs, body.lat, body.lon, 1.5, "IFR")
    return {"state": r["state"], "district": r["district"],
            "values": {k: r["values"][k] for k in ("soil_ph", "soil_organic_carbon", "groundwater_stress_pct", "rainfall_mm_avg")},
            "sources": r["sources"]}


class Inputs(BaseModel):
    land_area_ha: float = Field(..., description="hectares")
    claim_type: str = Field(..., description="IFR, CFR or CR")
    soil_ph: float
    soil_organic_carbon: float = Field(..., description="g/kg")
    groundwater_stress_pct: float
    rainfall_mm_avg: float


class SweepIn(BaseModel):
    inputs: Inputs
    feature: str
    points: int = 41


@router.post("/predict")
def predict(body: Inputs):
    return _wrap(ml_inference.predict_all, body.model_dump())


@router.post("/sweep")
def sweep(body: SweepIn):
    return _wrap(ml_inference.sweep, body.inputs.model_dump(), body.feature, body.points)


# -----------------------------------------------------------------------------
# Rules
# -----------------------------------------------------------------------------
RULE_INPUTS = {
    "pm_kisan_score": ["claim_type"],
    "mgnrega_score": ["groundwater_stress_pct", "soil_ph", "soil_organic_carbon", "land_area_ha", "claim_type", "is_scheduled_area"],
    "jjm_score": ["rainfall_mm_avg", "groundwater_stress_pct", "is_scheduled_area"],
    "pmfby_score": ["rainfall_mm_avg"],
    "pmksy_score": ["groundwater_stress_pct", "rainfall_mm_avg", "is_scheduled_area", "land_area_ha", "claim_type", "soil_ph", "soil_organic_carbon"],
    "soil_health_card_score": ["soil_ph", "soil_organic_carbon"],
}
CUTOFF_SCHEMES = ["soil_health_card_score", "mgnrega_score", "pmksy_score"]   # the rules that read the pH/OC bands
_rules_lock = threading.Lock()


@router.get("/rules")
def rules():
    return {
        "module_doc": inspect.getdoc(scheme_rules),
        "schemes": {t: {"name": ml_inference.SCHEME_LABELS[t], "doc": inspect.getdoc(fn), "inputs": RULE_INPUTS[t],
                        "noise_sd": scheme_rules.NOISE_SD[t]}
                    for t, fn in scheme_rules.SCORERS.items()},
        "constants": {"PH_LOW": scheme_rules.PH_LOW, "PH_HIGH": scheme_rules.PH_HIGH,
                      "OC_LOW_PCT": scheme_rules.OC_LOW_PCT, "OC_HIGH_PCT": scheme_rules.OC_HIGH_PCT},
        "constant_sources": {"PH_LOW": "anchor (Soil Health Card pH band)", "PH_HIGH": "anchor (Soil Health Card pH band)",
                             "OC_LOW_PCT": "constructed (lower third of this data's real readings)",
                             "OC_HIGH_PCT": "constructed (upper third of this data's real readings)"},
    }


class CutoffIn(BaseModel):
    ph_low: float = Field(scheme_rules.PH_LOW, ge=4, le=9)
    ph_high: float = Field(scheme_rules.PH_HIGH, ge=4, le=9)
    oc_low_pct: float = Field(scheme_rules.OC_LOW_PCT, ge=0.1, le=5)
    oc_high_pct: float = Field(scheme_rules.OC_HIGH_PCT, ge=0.1, le=5)


def _cutoff(body: CutoffIn) -> Dict[str, Any]:
    if body.ph_low > body.ph_high or body.oc_low_pct > body.oc_high_pct:
        raise ml_inference.InputError("low cutoffs must not exceed high cutoffs")
    ml_inference._require_loaded()
    ref = ml_inference._state["ref"]
    frame = ref[RAW_FEATURES]
    with _rules_lock:   # the rules read module-level constants; patch them briefly
        saved = (scheme_rules.PH_LOW, scheme_rules.PH_HIGH, scheme_rules.OC_LOW_PCT, scheme_rules.OC_HIGH_PCT)
        try:
            before = ml_inference.rule_scores(frame)
            scheme_rules.PH_LOW, scheme_rules.PH_HIGH = body.ph_low, body.ph_high
            scheme_rules.OC_LOW_PCT, scheme_rules.OC_HIGH_PCT = body.oc_low_pct, body.oc_high_pct
            after = ml_inference.rule_scores(frame)
        finally:
            scheme_rules.PH_LOW, scheme_rules.PH_HIGH, scheme_rules.OC_LOW_PCT, scheme_rules.OC_HIGH_PCT = saved
    out = {}
    for t in CUTOFF_SCHEMES:
        b, a = before[t], after[t]
        changed = np.abs(a - b) > 1e-9
        by_d = {}
        for d in sorted(ref.district.unique()):
            m = (ref.district == d).to_numpy()
            by_d[d] = {"before": round(float(b[m].mean()), 2), "after": round(float(a[m].mean()), 2),
                       "changed_share": round(float(changed[m].mean()), 4)}
        out[t] = {"name": ml_inference.SCHEME_LABELS[t], "changed_share": round(float(changed.mean()), 4),
                  "mean_before": round(float(b.mean()), 2), "mean_after": round(float(a.mean()), 2),
                  "mean_abs_shift": round(float(np.abs(a - b).mean()), 2), "by_district": by_d}
    ph, oc = ref.soil_ph.to_numpy(), ref.soil_organic_carbon.to_numpy() / 10
    return {"cutoffs": body.model_dump(), "schemes": out, "plots": int(len(ref)),
            "band_counts": {"ph": {"acidic": int((ph < body.ph_low).sum()), "neutral": int(((ph >= body.ph_low) & (ph <= body.ph_high)).sum()),
                                   "alkaline": int((ph > body.ph_high).sum())},
                            "oc": {"low": int((oc < body.oc_low_pct).sum()), "mid": int(((oc >= body.oc_low_pct) & (oc <= body.oc_high_pct)).sum()),
                                   "high": int((oc > body.oc_high_pct).sum())}},
            "note": "Noiseless rule scores on all 1,540 plots; no model is retrained."}


@router.post("/rules/cutoff")
def cutoff(body: CutoffIn):
    return _wrap(_cutoff, body)


@router.get("/extraction-quality")
async def extraction_quality(refresh: bool = False):
    from backend.services import extraction_eval
    return await run_in_threadpool(extraction_eval.evaluate, refresh)
