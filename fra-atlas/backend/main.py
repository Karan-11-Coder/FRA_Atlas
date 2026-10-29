# backend/main.py
"""
FRA Atlas API: the backend of the ML dashboard.

  /api/lab/*          model lab: precomputed views + live predict / sweep / rule cutoffs
  /api/diagnostics    DSS scores for a stored claim or coordinates (chosen models)
  /api/claims/*       claims CRUD, import/export, document-AI intake (OCR + NER)
  /api/villages       reference villages

There is no authentication: the dashboard is meant for local or demo use.
Run from fra-atlas/:  uvicorn backend.main:app --reload --port 8000
"""
import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Explicit path: a bare load_dotenv() finds nothing inside uvicorn --reload's
# subprocess on Windows.
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import Depends, FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402
from sqlalchemy.future import select  # noqa: E402

from backend.db import DATABASE_URL, engine, get_db, init_claims_table, init_villages_table  # noqa: E402
from backend.models import Base, Village  # noqa: E402
from backend.routes.claims import router as claims_router  # noqa: E402
from backend.routes.diagnostics import router as diagnostics_router  # noqa: E402
from backend.routes.lab import router as lab_router  # noqa: E402
from backend.services import ml_inference  # noqa: E402
from backend.services.villages import upsert_village  # noqa: E402

logger = logging.getLogger(__name__)

app = FastAPI(title="FRA Atlas API", version="2.0.0",
              description="ML dashboard backend. Scores are rule-derived suitability, not eligibility decisions.")

app.include_router(lab_router, prefix="/api")
app.include_router(diagnostics_router, prefix="/api")
app.include_router(claims_router, prefix="/api")

_env_origins = os.getenv("CORS_ORIGINS")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _env_origins.split(",") if o.strip()] if _env_origins
    else ["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info("backend.main using DATABASE_URL = %s", DATABASE_URL)


@app.on_event("startup")
async def on_startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await init_claims_table()
    await init_villages_table()
    # Models load once; if missing, /api/lab live routes and /api/diagnostics return 503.
    ml_inference.load()


@app.get("/")
async def root():
    return {"message": "FRA Atlas API", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}


# -----------------------------------------------------------------------------
# Villages
# -----------------------------------------------------------------------------
@app.get("/api/villages")
async def list_villages(db: AsyncSession = Depends(get_db)):
    villages = (await db.execute(select(Village))).scalars().all()
    return [{"id": v.id, "state": v.state, "district": v.district, "block": v.block, "village": v.village,
             "lat": v.lat, "lon": v.lon, "created_at": v.created_at} for v in villages]


class VillageIn(BaseModel):
    state: str
    district: str
    village: str
    block: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None


@app.post("/api/villages")
async def create_village(payload: VillageIn, db: AsyncSession = Depends(get_db)):
    """Upsert a village by (state, district, village); geocodes when no plausible coordinates are given."""
    village = await upsert_village(db, state=payload.state, district=payload.district, village=payload.village,
                                   claimed_lat=payload.lat, claimed_lon=payload.lon)
    await db.commit()
    if village is None:
        raise HTTPException(status_code=400, detail="state, district, and village are required")
    return {"id": village.id, "state": village.state, "district": village.district, "block": village.block,
            "village": village.village, "lat": village.lat, "lon": village.lon}
