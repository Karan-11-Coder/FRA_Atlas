# backend/main.py
"""
Consolidated FastAPI entrypoint for FRA Atlas API.

Notes:
- Loads .env once
- Creates a single FastAPI app
- Includes routers (tribal auth has its own prefix)
- Sets up CORS and upload directory
- Prints DATABASE_URL for debugging (if available)
"""

from pathlib import Path
import os
import logging
from dotenv import load_dotenv

# Load environment variables before importing any backend module — several
# (routes.auth, routes.auth_tribal) read required env vars like JWT_SECRET
# at import time, so this must run first.
#
# Pass the path explicitly rather than calling load_dotenv() bare: its
# default find_dotenv() walks up from the *calling frame's* file location,
# and inside uvicorn --reload's spawned subprocess on Windows that frame
# inspection resolves to somewhere that isn't backend/, so it silently finds
# no .env at all. This crashed on every --reload run (the app's own
# documented dev workflow) because JWT_SECRET then reads as unset — masked
# before only because the old code had an insecure hardcoded fallback.
load_dotenv(Path(__file__).resolve().parent / ".env")

# FastAPI imports
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Optional extra FastAPI imports kept minimal here; routers may use these in their own modules
from fastapi import UploadFile, File, Depends, HTTPException, Body, Query, Response, Request
from fastapi.responses import StreamingResponse

# SQLAlchemy / DB helpers
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import text

# standard libs
import io
import re
import json
import sqlite3
import datetime
import pathlib
import uuid
from typing import Optional, Dict, Any

 # FastAPI OpenAPI customization
from fastapi.openapi.utils import get_openapi
from backend.routes.auth import get_current_user
from fastapi.security import HTTPBearer
bearer_scheme = HTTPBearer()

# Project helpers / DB / models (adjust names/paths as your project uses)
from backend.ocr import extract_text
from backend.ner import extract_entities
from backend.utils.normalize_claims import normalize_entities

from backend.db import (
    get_db,
    engine,
    init_claims_table,
    insert_claim,
    query_claims,
    get_claim_by_id,
    init_villages_table,
    DATABASE_URL,  # for optional debug print
)

from backend.models import Base, Village
from backend.services.villages import upsert_village
from pydantic import BaseModel

# Routers (import routers once)
from backend.routes.diagnostics import router as diagnostics_router
from backend.routes.auth import router as auth_router
from backend.routes.claims import router as claims_router
from backend.routes import auth_tribal  # this module defines router = APIRouter(prefix="/auth/tribal", ...)
from backend.routes import officers

# ----------------------------------------------------------------------
# Create single FastAPI app and configure
# ----------------------------------------------------------------------
app = FastAPI(title="FRA Atlas API")

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="FRA Atlas API",
        version="0.1.0",
        description="FRA Atlas Backend",
        routes=app.routes,
    )

    openapi_schema.setdefault("components", {})
    openapi_schema["components"].setdefault("securitySchemes", {})

    # 🔑 IMPORTANT: name MUST be HTTPBearer
    openapi_schema["components"]["securitySchemes"]["HTTPBearer"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }

    # 🔑 IMPORTANT: same name here
    openapi_schema["security"] = [{"HTTPBearer": []}]

    app.openapi_schema = openapi_schema
    return app.openapi_schema

# include tribal auth router (router already has its own prefix "/auth/tribal")
app.include_router(auth_tribal.router)

# include other routers under /api
app.include_router(diagnostics_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(claims_router, prefix="/api")
app.include_router(officers.router)

# -----------------------------------------------------------------------------
# CORS configuration
# -----------------------------------------------------------------------------
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_env_origins = os.getenv("CORS_ORIGINS")
CORS_ORIGINS = (
    [o.strip() for o in _env_origins.split(",") if o.strip()]
    if _env_origins
    else _DEFAULT_CORS_ORIGINS
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Upload dir
# -----------------------------------------------------------------------------
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

_DEBUG_ROUTES_ENABLED = os.getenv("ENABLE_DEBUG_ROUTES") == "1"
logging.getLogger(__name__).info("backend.main using DATABASE_URL = %s", DATABASE_URL)

# ----------------------------------------------------------------------
# Simple root endpoint to verify the backend runs
# ----------------------------------------------------------------------
@app.get("/")
async def root():
    return {"message": "Backend running"}


# -----------------------------------------------------------------------------
# Startup: create tables & (optionally) seed villages
# -----------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    # Create SQLAlchemy models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Ensure helper tables exist
    await init_claims_table()
    await init_villages_table()

    # Optional seeding controlled by env var
    try:
        async with engine.begin() as conn:
            try:
                res = await conn.execute(text("SELECT COUNT(*) FROM villages"))
                try:
                    count = res.scalar_one()
                except Exception:
                    row = res.fetchone()
                    count = int(row[0]) if row else 0
            except Exception:
                count = 0

            if count == 0 and os.environ.get("SEED_VILLAGES") == "1":
                await conn.execute(text("""
                    INSERT INTO villages (state,district,block,village,lat,lon,created_at)
                    VALUES
                      ('Unknown','Unknown',NULL,'Village A',21.14,79.08,datetime('now')),
                      ('Unknown','Unknown',NULL,'Village B',21.16,79.10,datetime('now')),
                      ('Unknown','Unknown',NULL,'Village C',21.12,79.12,datetime('now'))
                """))
    except Exception:
        # never fail startup because of seeding
        pass

# -----------------------------------------------------------------------------
# Health & Ping
# -----------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/ping")
def ping():
    return {"message": "pong", "service": "FRA Atlas Backend"}

# -----------------------------------------------------------------------------
# Debug-only routes — never registered unless ENABLE_DEBUG_ROUTES=1, and even
# then require an authenticated admin. Not mounted by default.
# -----------------------------------------------------------------------------
if _DEBUG_ROUTES_ENABLED:
    @app.post("/debug/echo")
    async def debug_echo(request: Request, current_user=Depends(get_current_user)):
        if current_user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        body = await request.body()
        try:
            s = body.decode("utf-8")
        except Exception:
            s = repr(body)
        logging.getLogger(__name__).debug("DEBUG ECHO BODY (%d bytes): %s", len(body), s)
        return {"ok": True, "len": len(body)}

    @app.get("/api/_debug_db_info")
    async def _debug_db_info(current_user=Depends(get_current_user)):
        """
        Show resolved sqlite file (if using sqlite) and a peek at rows.
        """
        if current_user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")

        env_url = os.environ.get("DATABASE_URL", None)

        resolved = None
        file_part = None
        try:
            if isinstance(DATABASE_URL, str) and DATABASE_URL.startswith("sqlite"):
                file_part = DATABASE_URL.split(":///")[-1]
                resolved = str(Path(file_part).resolve())
            elif env_url and env_url.startswith("sqlite"):
                file_part = env_url.split(":///")[-1]
                resolved = str(Path(file_part).resolve())
            else:
                repo_root = Path(__file__).resolve().parent.parent
                resolved = str((repo_root / "fra_atlas.db").resolve())
        except Exception:
            try:
                resolved = str(Path(file_part).as_posix())
            except Exception:
                resolved = "unknown"

        villages = None
        claims = None
        try:
            conn = sqlite3.connect(resolved)
            cur = conn.cursor()
            try:
                villages = cur.execute(
                    "SELECT id,state,district,block,village,lat,lon FROM villages ORDER BY id"
                ).fetchall()
            except Exception as e:
                villages = f"ERR:{e}"
            try:
                claims = cur.execute(
                    "SELECT id,state,district,village,lat,lon FROM claims ORDER BY id"
                ).fetchall()
            except Exception as e:
                claims = f"ERR:{e}"
            conn.close()
        except Exception as e:
            villages = f"ERR_OPEN:{e}"
            claims = f"ERR_OPEN:{e}"

        return {
            "env_DATABASE_URL": env_url,
            "resolved_db_file": resolved,
            "villages_rows": villages,
            "claims_rows": claims,
        }

# -----------------------------------------------------------------------------
# Small helpers for OCR→NER mapping
# -----------------------------------------------------------------------------
def _title_if_name(s: str | None) -> str | None:
    if not s:
        return None
    # avoid title-casing codes like IFR-123/2020
    return s if re.search(r'[0-9\-\/]', s) else s.title()

def _normalize_names(payload: dict) -> dict:
    # expand these maps as you see more variants
    state_map = {
        "mp": "Madhya Pradesh",
        "madhya pradesh": "Madhya Pradesh",
    }
    district_map = {
        "sehore": "Sehore",
    }
    st = (payload.get("state") or "").strip().lower()
    di = (payload.get("district") or "").strip().lower()

    payload["state"] = state_map.get(st, payload.get("state"))
    payload["district"] = district_map.get(di, payload.get("district"))

    if payload.get("village"):
        payload["village"] = _title_if_name(payload["village"].strip())
    if payload.get("patta_holder"):
        payload["patta_holder"] = _title_if_name(payload["patta_holder"].strip())
    if payload.get("status"):
        payload["status"] = _title_if_name(payload["status"].strip())
    return payload

def _row_to_dict(row) -> Dict[str, Any]:
    if row is None:
        return {}
    try:
        return {k: row[k] for k in row.keys()}
    except Exception:
        try:
            return dict(row)
        except Exception:
            return {}

# -----------------------------------------------------------------------------
# FRA Document upload → OCR → NER → insert Claim
# -----------------------------------------------------------------------------
@app.post("/api/upload-fra", dependencies=[Depends(bearer_scheme)])
async def upload_fra(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload FRA document.
    Auto-assigns claim to logged-in officer.
    """

    try:
        safe_suffix = pathlib.Path(file.filename or "").suffix or ".pdf"
        safe_name = f"{uuid.uuid4().hex}{safe_suffix}"
        file_path = (UPLOAD_DIR / safe_name).resolve()
        if UPLOAD_DIR.resolve() not in file_path.parents:
            raise HTTPException(status_code=400, detail="Invalid filename")
        with open(file_path, "wb") as f:
            f.write(await file.read())

        # Considered officer
        officer_id = current_user["id"]

        # OCR + NER
        text = extract_text(str(file_path))
        entities = extract_entities(text)

        # One document = one claim, so take the first candidate
        # normalize_entities() produces (it returns one claim dict per
        # village found, for the rare multi-village document).
        candidates = normalize_entities(entities)
        base = candidates[0] if candidates else {}

        payload = {
            **base,
            "state": base.get("state") or "Unknown",
            "district": base.get("district") or "Unknown",
            "status": "Pending",
            "source": "ocr",
            "raw_ocr": json.dumps(entities),

            # 🔐 CRITICAL PART
            "assigned_officer_id": officer_id,
            "assigned_date": datetime.date.today().isoformat(),
        }
        payload.pop("raw_ner", None)

        payload = _normalize_names(payload)
        created = await insert_claim(payload)

        return {
            "message": "Claim created and assigned to officer",
            "officer_id": officer_id,
            "claim": created,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------------------------------------------------------
# Villages list (for dropdowns, seeding, etc.)
# -----------------------------------------------------------------------------
@app.get("/api/villages")
async def list_villages(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Village))
        villages = result.scalars().all()
        return [
            {
                "id": v.id,
                "state": v.state,
                "district": v.district,
                "block": v.block,
                "village": v.village,
                "lat": v.lat,
                "lon": v.lon,
                "created_at": v.created_at,
            }
            for v in villages
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class VillageIn(BaseModel):
    state: str
    district: str
    village: str
    block: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None


@app.post("/api/villages")
async def create_village(
    payload: VillageIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Upsert a village by (state, district, village). If lat/lon aren't given
    (or fall outside India's bounding box), falls back to geocoding via
    Nominatim. Used by bulk_insert_villages.py and available for any UI that
    wants to seed a village directly rather than only picking one up from a
    claim.
    """
    try:
        village = await upsert_village(
            db,
            state=payload.state,
            district=payload.district,
            village=payload.village,
            claimed_lat=payload.lat,
            claimed_lon=payload.lon,
        )
        await db.commit()
        if village is None:
            # state/district/village normalized down to an empty string
            raise HTTPException(status_code=400, detail="state, district, and village are required")
        return {
            "id": village.id,
            "state": village.state,
            "district": village.district,
            "block": village.block,
            "village": village.village,
            "lat": village.lat,
            "lon": village.lon,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# NOTE:
# CRUD for claims are provided by backend/routes/claims.py and mounted under /api.
