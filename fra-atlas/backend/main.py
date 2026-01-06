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
from dotenv import load_dotenv

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
from typing import Optional, Dict, Any

# load environment variables once
load_dotenv()

# Project helpers / DB / models (adjust names/paths as your project uses)
from backend.ocr import extract_text
from backend.ner import extract_entities

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

# Routers (import routers once)
from backend.routes.diagnostics import router as diagnostics_router
from backend.routes.auth import router as auth_router
from backend.routes.claims import router as claims_router
from backend.routes import auth_tribal  # this module defines router = APIRouter(prefix="/auth/tribal", ...)

# ----------------------------------------------------------------------
# Create single FastAPI app and configure
# ----------------------------------------------------------------------
app = FastAPI(title="FRA Atlas API")

# include tribal auth router (router already has its own prefix "/auth/tribal")
app.include_router(auth_tribal.router)

# include other routers under /api
app.include_router(diagnostics_router, prefix="/api")
app.include_router(auth_router,        prefix="/api")
app.include_router(claims_router,      prefix="/api")

# -----------------------------------------------------------------------------
# CORS configuration (adjust origins if necessary)
# -----------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Upload dir
# -----------------------------------------------------------------------------
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Debug print (optional)
try:
    print("DEBUG: backend.main sees DATABASE_URL =", DATABASE_URL, flush=True)
except NameError:
    print("DEBUG: DATABASE_URL not available", flush=True)

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
# Debug echo (raw body) — handy for uploads/webhooks
# -----------------------------------------------------------------------------
@app.post("/debug/echo")
async def debug_echo(request: Request):
    body = await request.body()
    print("DEBUG ECHO GOT BYTES:", len(body), flush=True)
    try:
        s = body.decode("utf-8")
    except Exception:
        s = repr(body)
    print("DEBUG ECHO BODY:", s, flush=True)
    return {"ok": True, "len": len(body)}

# -----------------------------------------------------------------------------
# DB info debug endpoint
# -----------------------------------------------------------------------------
@app.get("/api/_debug_db_info")
async def _debug_db_info():
    """
    Show resolved sqlite file (if using sqlite) and a peek at rows.
    """
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
def _first(x):
    return (x or [None])[0] if isinstance(x, list) else x

def _clean_line(s: str | None) -> str | None:
    if not s:
        return None
    # keep only the first line and trim any leaked trailing labels
    s = s.splitlines()[0].strip()
    s = re.sub(r'\s*(?:state|district|village|patta\s*holder)\s*$', '', s, flags=re.I)
    return ' '.join(s.split())

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
@app.post("/api/upload-fra")
async def upload_fra(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """
    Upload a FRA PDF, run OCR+NER, and create a claim directly.
    Returns the created claim.
    """
    try:
        # save uploaded file
        file_path = UPLOAD_DIR / file.filename
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # OCR + NER
        text = extract_text(str(file_path))
        entities = extract_entities(text)

        # clean + map
        state    = _clean_line(entities.get("state")    or _first(entities.get("states")))
        district = _clean_line(entities.get("district") or _first(entities.get("districts")))
        village  = _clean_line(_first(entities.get("villages")))
        patta    = _clean_line(_first(entities.get("patta_holders")))
        date_    = _clean_line(_first(entities.get("dates")))
        ifr_no   = _clean_line(entities.get("ifr_number"))
        area     = _clean_line(entities.get("land_area") or entities.get("area"))
        status   = _clean_line(entities.get("status"))
        lat      = entities.get("lat")
        lon      = entities.get("lon")

        claim_payload = {
            "state":    state or "Unknown",
            "district": district or "Unknown",
            "block":    None,
            "village":  village,
            "patta_holder": patta,
            "address":  None,
            "land_area": area,
            "status":   status or "Pending",  # prefer NER; else Pending
            "date":     date_,
            "lat":      lat if isinstance(lat, (int, float)) else None,
            "lon":      lon if isinstance(lon, (int, float)) else None,
            "source":   "ocr",
            "raw_ocr":  json.dumps({"entities": entities, "extracted_text": text}),
        }

        claim_payload = _normalize_names(claim_payload)

        # insert
        created = await insert_claim(claim_payload)

        return {
            "filename": file.filename,
            "message": "File uploaded, OCR/NER extracted and claim created",
            "entities": entities,
            "extracted_text": text,
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

# NOTE:
# CRUD for claims are provided by backend/routes/claims.py and mounted under /api.
