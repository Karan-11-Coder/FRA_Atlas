# fra-atlas/backend/routes/diagnostics.py
"""
DSS scheme-suitability scores for a claim, from the trained models in
ml/artifacts/model.joblib (see backend/services/ml_inference.py and
ml/MODEL_CARD.md).

The scores reproduce rule-derived labels (backend/services/scheme_rules.py);
they are suitability indicators, not eligibility decisions. If the model
can't be loaded this returns 503 — it never falls back to made-up numbers.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend import db
from backend.routes.auth import get_current_user
from backend.services import ml_inference

router = APIRouter()


class DiagnosticsRequest(BaseModel):
    claim_id: Optional[int] = Field(None, description="Claim to score; its lat/lon/land_area fill any field not sent")
    lat: Optional[float] = None
    lon: Optional[float] = None
    land_area: Optional[float] = Field(None, description="Land area in hectares")
    claim_type: Optional[str] = Field(None, description="IFR, CFR or CR (claims don't store this yet, so the caller supplies it)")


class SchemeResult(BaseModel):
    key: str
    name: str
    score: int
    reasons: List[str]
    top_inputs: List[Dict[str, Any]]
    model: str
    typical_error: float
    test_r2: float


class DiagnosticsResponse(BaseModel):
    claim_id: Optional[int]
    state: str
    district: str
    input: Dict[str, Any]
    metrics: Dict[str, Any]
    estimated_inputs: List[Dict[str, Any]]
    notes: List[str]
    recommendations: List[SchemeResult]
    disclaimer: str
    model_info: Dict[str, Any]


@router.get("/diagnostics/status")
def diagnostics_status():
    """Whether the DSS model is loaded (no claim data involved)."""
    return ml_inference.status()


@router.post("/diagnostics", response_model=DiagnosticsResponse)
async def run_diagnostics(req: DiagnosticsRequest, current_user=Depends(get_current_user)):
    lat, lon, land_area, claim_type = req.lat, req.lon, req.land_area, req.claim_type

    if req.claim_id is not None:
        claim = await db.get_claim_by_id(req.claim_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")
        lat = lat if lat is not None else claim.get("lat")
        lon = lon if lon is not None else claim.get("lon")
        land_area = land_area if land_area is not None else claim.get("land_area")
        claim_type = claim_type or claim.get("claim_type")

    try:
        result = ml_inference.predict_schemes(lat=lat, lon=lon, land_area_ha=land_area, claim_type=claim_type)
    except ml_inference.ModelUnavailable as e:
        raise HTTPException(status_code=503, detail=f"DSS model unavailable: {e}")
    except ml_inference.InputError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return {
        "claim_id": req.claim_id,
        "state": result["state"],
        "district": result["district"],
        "input": {"lat": lat, "lon": lon, "land_area": land_area, "claim_type": claim_type},
        "metrics": result["inputs"],
        "estimated_inputs": result["estimated_inputs"],
        "notes": result["notes"],
        "recommendations": result["recommendations"],
        "disclaimer": result["disclaimer"],
        "model_info": result["model_info"],
    }
