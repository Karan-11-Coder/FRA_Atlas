from fastapi import (
    APIRouter,
    Query,
    HTTPException,
    Path,
    status,
    Body,
    Depends,
    Response,
    UploadFile,
    File,
    Request,
)
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Any, Tuple, List
from pydantic import BaseModel
from backend import db
import sqlite3
from starlette.concurrency import run_in_threadpool
import pathlib
import logging
from sqlalchemy import text
import asyncio
import json
from urllib.parse import urlencode
from urllib.request import urlopen, Request as UrlRequest
import io
import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from backend.ocr import extract_text
from backend.ner import extract_entities
from backend.db import get_db  # used as Depends(get_db) in some endpoints
from pathlib import Path as PPath
import uuid
import traceback
import os

# ✅ NEW (add these)
from sqlalchemy import text as sa_text
from backend.db import insert_claim
from backend.routes.auth import get_current_user
import datetime 





router = APIRouter()
logger = logging.getLogger(__name__)

# -------------------------
# Temp upload dir (single canonical definition)
# -------------------------
TEMP_UPLOAD_DIR = PPath("uploads/temp")
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# India bounding box (lat_min, lon_min, lat_max, lon_max)
INDIA_BBOX: Tuple[float, float, float, float] = (6.0, 68.0, 37.5, 97.5)


# -------------------------
# Helpers for Option B
# -------------------------

def _normalize_part(s: Optional[str]) -> str:
    if not s:
        return ""
    s = " ".join(str(s).strip().split())
    # Title-case to keep data consistent (Bhopal, Madhya Pradesh)
    return s.title()


def _normalize_triplet(state: Optional[str], district: Optional[str], village: Optional[str]) -> Tuple[str, str, str]:
    return _normalize_part(state), _normalize_part(district), _normalize_part(village)


def _coords_plausible(lat: Optional[float], lon: Optional[float]) -> bool:
    try:
        lat = float(lat) if lat is not None else None
        lon = float(lon) if lon is not None else None
    except (TypeError, ValueError):
        return False
    if lat is None or lon is None:
        return False
    lat_min, lon_min, lat_max, lon_max = INDIA_BBOX
    return (lat_min <= lat <= lat_max) and (lon_min <= lon <= lon_max)


async def _geocode_village_backend(state: str, district: str, village: str) -> Optional[Tuple[float, float]]:
    """
    Geocode on the server using Nominatim with a polite delay.
    Uses stdlib urllib in a thread so we don't add dependencies.
    """
    query = f"{village}, {district}, {state}, India"
    url = "https://nominatim.openstreetmap.org/search?" + urlencode({"format": "json", "q": query})
    headers = {
        "User-Agent": "fra-atlas/1.0 (contact: you@example.com)"
    }

    def _do_req_sync() -> Optional[Tuple[float, float]]:
        try:
            req = UrlRequest(url, headers=headers)
            with urlopen(req, timeout=10) as resp:
                data = resp.read()
            arr = json.loads(data.decode("utf-8"))
            if not arr:
                return None
            lat = float(arr[0].get("lat"))
            lon = float(arr[0].get("lon"))
            return (lat, lon)
        except Exception as e:
            logger.warning("Geocoding failed for %s | %s", query, e)
            return None

    # Nominatim polite rate limit
    await asyncio.sleep(1.1)
    return await run_in_threadpool(_do_req_sync)


async def _upsert_village(
    *,
    state: str,
    district: str,
    village: str,
    claimed_lat: Optional[float],
    claimed_lon: Optional[float],
) -> None:
    """
    Ensure (state,district,village) exists in `villages`.
    - If row exists but missing coords and claim coords are plausible -> update coords.
    - If row does not exist:
        * If claim coords plausible -> insert with them
        * Else try geocoding -> insert with result
        * Else insert with NULL coords
    Uses SQLite-compatible SQL (INSERT OR IGNORE).
    """
    state, district, village = _normalize_triplet(state, district, village)
    if not (state and district and village):
        return

    try:
        async with db.engine.begin() as conn:
            # Does village already exist?
            sel = await conn.execute(
                text(
                    """
                    SELECT id, lat, lon
                    FROM villages
                    WHERE state = :state AND district = :district AND village = :village
                    """
                ),
                {"state": state, "district": district, "village": village},
            )
            existing = sel.fetchone()

            # If exists and coords missing but claim coords plausible -> update
            if existing:
                row_id = existing[0]
                existing_lat = existing[1]
                existing_lon = existing[2]
                if (existing_lat is None or existing_lon is None) and _coords_plausible(claimed_lat, claimed_lon):
                    await conn.execute(
                        text(
                            """
                            UPDATE villages
                            SET lat = :lat, lon = :lon
                            WHERE id = :id
                            """
                        ),
                        {"lat": float(claimed_lat), "lon": float(claimed_lon), "id": row_id},
                    )
                return

            # Not exists -> decide coords
            ins_lat, ins_lon = (None, None)
            if _coords_plausible(claimed_lat, claimed_lon):
                ins_lat, ins_lon = float(claimed_lat), float(claimed_lon)
            else:
                geo = await _geocode_village_backend(state, district, village)
                if geo:
                    ins_lat, ins_lon = geo

            # INSERT OR IGNORE to respect unique index (if added)
            await conn.execute(
                text(
                    """
                    INSERT OR IGNORE INTO villages(state, district, village, lat, lon, created_at)
                    VALUES (:state, :district, :village, :lat, :lon, datetime('now'))
                    """
                ),
                {"state": state, "district": district, "village": village, "lat": ins_lat, "lon": ins_lon},
            )
    except Exception as e:
        logger.warning("upsert_village failed for %s/%s/%s: %s", state, district, village, e)


# =========================
# CLAIMS ROUTES
# =========================

@router.get("/claims", tags=["claims"])
@router.get("/api/claims", tags=["claims"])
async def get_claims(
    # ✅ allow state/district too (your db.query_claims likely supports these)
    state: Optional[str] = None,
    district: Optional[str] = None,
    village: Optional[str] = None,
    status: Optional[str] = None,
    limit: Optional[int] = Query(None, ge=1),
    offset: int = 0,
):
    """
    Return claims. Optional filters: state, district, village, status.
    Supports optional `limit`, `offset`.
    """
    try:
        filters: Dict[str, Any] = {}
        if state:
            filters["state"] = state
        if district:
            filters["district"] = district
        if village:
            filters["village"] = village
        if status:
            filters["status"] = status
        if limit is not None:
            filters["limit"] = int(limit)
            filters["offset"] = int(offset)
        rows = await db.query_claims(filters)
        return rows
    except Exception as e:
        logger.exception(
            "get_claims failed: state=%s district=%s village=%s status=%s limit=%s offset=%s",
            state, district, village, status, limit, offset
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/claims/count", tags=["claims"])
@router.get("/api/claims/count", tags=["claims"])
async def get_claims_count(village: str):
    """
    Return {"count": N} for the exact village name provided.
    """
    if not village:
        raise HTTPException(status_code=400, detail="Missing 'village' query parameter")
    try:
        cnt = await db.count_claims_by_village(village)
        return {"count": cnt}
    except Exception as e:
        logger.exception("get_claims_count failed for village=%s", village)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/claims/my", tags=["claims"])
@router.get("/api/claims/my", tags=["claims"])
async def get_my_assigned_claims(request: Request):
    """
    Return claims assigned to the currently logged-in officer.
    Officer identity is derived from JWT token.
    """
    # 1️⃣ Identify officer from token
    user = await get_current_user(request)
    officer_id = user["id"]

    db_path = _get_default_db_path()

    # 2️⃣ Fetch assigned claims
    def _fetch():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT *
            FROM claims
            WHERE assigned_officer_id = ?
            ORDER BY last_status_update DESC
            """,
            (officer_id,)
        )
        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]

    try:
        claims = await run_in_threadpool(_fetch)
        return {
            "officer_id": officer_id,
            "count": len(claims),
            "claims": claims
        }
    except Exception as e:
        logger.exception("get_my_assigned_claims failed for officer=%s", officer_id)
        raise HTTPException(status_code=500, detail=str(e))


# -------------------------
# PUT /claims/{id} endpoint
# -------------------------
class ClaimUpdate(BaseModel):
    # allow updating these fields
    village: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    patta_holder: Optional[str] = None
    land_area: Optional[float] = None
    status: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    date: Optional[str] = None


async def _sqlite_get_claim_by_id(db_path: str, claim_id: int) -> Optional[Dict[str, Any]]:
    def _fn():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT * FROM claims WHERE id = ?", (claim_id,))
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None
    return await run_in_threadpool(_fn)


async def _sqlite_update_claim(db_path: str, claim_id: int, updates: Dict[str, Any]) -> None:
    def _fn():
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        if updates:
            sets = ", ".join([f"{k} = ?" for k in updates.keys()])
            params = list(updates.values()) + [claim_id]
            cur.execute(f"UPDATE claims SET {sets} WHERE id = ?", params)
            conn.commit()
        conn.close()
    return await run_in_threadpool(_fn)


def _get_default_db_path() -> str:
    base = pathlib.Path(__file__).resolve().parents[1]
    candidate = base / "fra_atlas.db"
    return str(candidate)


@router.put("/claims/{claim_id}", tags=["claims"])
@router.put("/api/claims/{claim_id}", tags=["claims"])
async def update_claim(
    request: Request,
    claim_id: int = Path(..., ge=1),
    payload: ClaimUpdate = Body(...)
):
    """
    Update a claim by id. Accepts only the fields defined in ClaimUpdate.
    Also ensures the (state,district,village) exists in `villages` (with coords if available).
    """
    db_path = _get_default_db_path()
    logger.info("update_claim called id=%s payload=%s", claim_id, payload.dict(exclude_unset=True))

    # -------------------------
    # STEP 3.3: identify officer
    # -------------------------
    user = await get_current_user(request)
    officer_id = user["id"]

    # fetch existing
    try:
        existing = await _sqlite_get_claim_by_id(db_path, claim_id)
    except Exception:
        logger.exception("failed to read claim before update id=%s", claim_id)
        raise HTTPException(status_code=500, detail="Failed to read claim before update")

    if not existing:
        raise HTTPException(status_code=404, detail="Claim not found")

    # allowed columns
    updates = {k: v for k, v in payload.dict(exclude_unset=True).items() if k in {
        "state", "district", "block", "village", "patta_holder",
        "address", "land_area", "status", "date", "lat", "lon"
    }}

    if not updates:
        return existing

    # -------------------------
    # STEP 3.3: officer audit fields
    # -------------------------
    updates["assigned_officer_id"] = officer_id
    updates["last_status_update"] = datetime.datetime.now(datetime.timezone.utc).isoformat()


    # mark closed date if granted
    if payload.status and payload.status.lower() == "granted":
        updates["closed_date"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # perform update
    try:
        await _sqlite_update_claim(db_path, claim_id, updates)
    except Exception:
        logger.exception("failed to update claim id=%s updates=%s", claim_id, updates)
        raise HTTPException(status_code=500, detail="Failed to update claim")

    # read back updated
    try:
        updated = await _sqlite_get_claim_by_id(db_path, claim_id)
    except Exception:
        logger.exception("failed to fetch updated claim id=%s", claim_id)
        raise HTTPException(status_code=500, detail="Failed to fetch updated claim")

    if not updated:
        raise HTTPException(status_code=500, detail="Claim updated but could not be retrieved")

    # ✅ ensure village exists/updated after claim update
    try:
        await _upsert_village(
            state=updated.get("state"),
            district=updated.get("district"),
            village=updated.get("village"),
            claimed_lat=updated.get("lat"),
            claimed_lon=updated.get("lon"),
        )
    except Exception as e:
        logger.warning("upsert village after update failed for claim id=%s: %s", claim_id, e)

    logger.info("update_claim succeeded id=%s", claim_id)
    return updated

# -------------------------
# Additional endpoints migrated from main.py
# -------------------------

@router.post("/claims", tags=["claims"])
@router.post("/api/claims", tags=["claims"])
async def create_claim(
    request: Request, 
    payload: dict = Body(...),                    # ✅ added
    db_session = Depends(db.get_db)
):
    """
    Create a new claim. Minimal required fields: state, district, village.
    Also upserts villages with coordinates (from claim or geocoding).
    """

    # ✅ identify logged-in officer
    user = await get_current_user(request)
    officer_id = user["id"]

    required = ["state", "district", "village"]
    for r in required:
        if not payload.get(r):
            raise HTTPException(status_code=400, detail=f"{r} is required")

    now_iso = datetime.datetime.utcnow().isoformat()

    # ✅ AUTO-LINK CLAIM TO OFFICER
    payload["assigned_officer_id"] = officer_id
    payload["assigned_date"] = now_iso
    payload["last_status_update"] = now_iso

    # ✅ if directly granted, also close it
    if payload.get("status") == "Granted":
     payload["closed_date"] = now_iso


    # insert claim
    try:
        created = await db.insert_claim(payload)
    except Exception as e:
        logger.exception("create_claim failed payload=%s", payload)
        raise HTTPException(status_code=500, detail=str(e))

    # ✅ ensure village exists (coords from claim if plausible, else geocode)
    try:
        await _upsert_village(
            state=payload.get("state"),
            district=payload.get("district"),
            village=payload.get("village"),
            claimed_lat=payload.get("lat"),
            claimed_lon=payload.get("lon"),
        )
    except Exception as e:
        logger.warning("upsert village after create failed: %s", e)

    return {"success": True, "claim": created}



@router.get("/claims/{claim_id}", tags=["claims"])
@router.get("/api/claims/{claim_id}", tags=["claims"])
async def get_claim(claim_id: int = Path(..., ge=1)):
    """
    Return a single claim by id.
    """
    try:
        claim = await db.get_claim_by_id(claim_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")
        return {"claim": claim}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_claim failed id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/claims/{claim_id}", tags=["claims"])
@router.delete("/api/claims/{claim_id}", tags=["claims"])
async def delete_claim(claim_id: int = Path(..., ge=1)):
    """
    Delete a single claim by id. Returns 204 on success.
    """
    try:
        async with db.engine.begin() as conn:
            row_res = await conn.execute(text("SELECT id FROM claims WHERE id = :id"), {"id": claim_id})
            found = row_res.fetchone()
            if not found:
                raise HTTPException(status_code=404, detail="Claim not found")
            await conn.execute(text("DELETE FROM claims WHERE id = :id"), {"id": claim_id})
        return Response(status_code=204)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("delete_claim failed id=%s", claim_id)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/claims", tags=["claims"])
@router.delete("/api/claims", tags=["claims"])
async def bulk_delete_claims(
    ids: Optional[str] = Query(None, description="Comma separated ids, e.g. ?ids=1,2,3"),
    payload: Optional[dict] = Body(None, description='Also accepts JSON body {"ids":[1,2,3]}'),
    confirm: bool = Query(False, description="Set true to confirm bulk delete"),
):
    """
    Bulk delete claims. Must pass confirm=true and ids either via ?ids=1,2 or JSON body {"ids":[...]}.
    """
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Bulk delete not confirmed. Use ?confirm=true and provide ids as ?ids=1,2,3 or JSON body {ids:[...]}",
        )

    id_list = []
    if ids:
        id_list = [int(x) for x in ids.split(",") if x.strip()]
    elif payload and isinstance(payload.get("ids"), list):
        try:
            id_list = [int(x) for x in payload.get("ids")]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid ids in payload")

    if not id_list:
        raise HTTPException(status_code=400, detail="No ids provided for bulk delete")

    id_csv = ",".join(str(i) for i in id_list)
    try:
        async with db.engine.begin() as conn:
            await conn.execute(text(f"DELETE FROM claims WHERE id IN ({id_csv})"))
        return {"deleted": len(id_list)}
    except Exception as e:
        logger.exception("bulk_delete_claims failed ids=%s", id_list)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/claims.csv", tags=["claims"])
@router.get("/api/export/claims.csv", tags=["claims"])
async def export_claims_csv():
    """
    Stream CSV of claims. Columns: id,state,district,block,village,patta_holder,address,land_area,status,date,lat,lon,created_at
    """
    async def iter_csv():
        header = ["id","state","district","block","village","patta_holder","address","land_area","status","date","lat","lon","created_at"]
        yield ",".join(header) + "\n"
        rows = await db.query_claims({})
        for r in rows:
            vals = [str(r.get(h,"") or "") for h in header]
            safe = [v.replace(",", " ") for v in vals]
            yield ",".join(safe) + "\n"
    return StreamingResponse(iter_csv(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=claims.csv"})


# -------------------------
# Excel/CSV import endpoint
# -------------------------

# --- helper to pick first matching column name ---

def pick_column(cols, *alts):
    alt_l = [a.lower() for a in alts]
    for c in cols:
        if c and c.lower().strip() in alt_l:
            return c
    return None


@router.post("/claims/import-excel", tags=["claims"])
async def import_excel(
    request: Request,                 # ✅ ADD THIS
    file: UploadFile = File(...),
    db_session = Depends(db.get_db)
):
    """
    Accepts .xlsx or .csv where each row is one claim.
    Expected-ish columns (case-insensitive):
      state, district, village, patta_holder, ifr_number, land_area, status, date, lat, lon
    Missing columns are allowed; rows with no village will still be created with village=null.
    """
    name = (file.filename or "").lower()
    content = await file.read()
    try:
        if name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read spreadsheet: {e}")

    if df.shape[0] == 0:
        return {"success": True, "count": 0, "claims": []}
    
    # ✅ identify logged-in officer ONCE
    user = await get_current_user(request)
    officer_id = user["id"]


    # normalize column names to original header list (keep original case to access rows)
    cols = list(df.columns)
    cols_l = [c.lower().strip() for c in cols]

    # map expected fields to actual columns (choose first matching)
    col_map = {
        "state": pick_column(cols, "state", "st", "province"),
        "district": pick_column(cols, "district", "dist"),
        "village": pick_column(cols, "village", "village_name", "gram"),
        "patta_holder": pick_column(cols, "patta_holder", "pattaholder", "name", "claimant"),
        "ifr_number": pick_column(cols, "ifr_number", "ifrno", "claim_id"),
        "land_area": pick_column(cols, "land_area", "area", "hectares", "ha"),
        "status": pick_column(cols, "status", "claim_status"),
        "date": pick_column(cols, "date", "claim_date", "application_date"),
        "lat": pick_column(cols, "lat", "latitude"),
        "lon": pick_column(cols, "lon", "lng", "longitude"),
    }

    created: List[Dict[str, Any]] = []
    errors = []

    for i, row in df.iterrows():
        try:
            def getcell(key):
                c = col_map.get(key)
                return None if c is None or pd.isna(row.get(c)) else row.get(c)

            payload = {
                "state": str(getcell("state")).strip() if getcell("state") is not None else None,
                "district": str(getcell("district")).strip() if getcell("district") is not None else None,
                "village": str(getcell("village")).strip() if getcell("village") is not None else None,
                "patta_holder": str(getcell("patta_holder")).strip() if getcell("patta_holder") is not None else None,
                "address": None,
                "land_area": str(getcell("land_area")).strip() if getcell("land_area") is not None else None,
                "status": str(getcell("status")).strip() if getcell("status") is not None else None,
                "date": str(getcell("date")).strip() if getcell("date") is not None else None,
                "lat": float(getcell("lat")) if getcell("lat") is not None else None,
                "lon": float(getcell("lon")) if getcell("lon") is not None else None,
                "source": "excel",
                "raw_ocr": None,

                "assigned_officer_id": officer_id,
                "assigned_date": datetime.datetime.utcnow().isoformat(),

            }

            # Insert claim using existing db helper
            created_claim = await db.insert_claim(payload)
            created.append(created_claim)

            # Optionally upsert village immediately (recommended) — keep this if you want villages table populated from imports
            try:
                await _upsert_village(
                    state=payload.get("state"),
                    district=payload.get("district"),
                    village=payload.get("village"),
                    claimed_lat=payload.get("lat"),
                    claimed_lon=payload.get("lon"),
                )
            except Exception as e:
                logger.warning("upsert village after import row %s failed: %s", i + 1, e)

        except Exception as e:
            errors.append({"row": int(i) + 1, "error": str(e)})

    return {"success": True, "count": len(created), "claims": created, "errors": errors}


@router.post("/claims/import-json", tags=["claims"])
async def import_json_verbose(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)

):
    """
    Robust import-json: shows per-row errors and falls back to direct SQL insert if insert_claim fails.
    Returns: { success, count, errors, claims }
    """

    # ✅ identify logged-in officer ONCE
    officer_id = current_user["id"]
    now_iso = datetime.datetime.utcnow().isoformat()
    
    rows = body.get("rows") if isinstance(body, dict) else None
    if not rows or not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="Missing 'rows' array")

    created = []
    errors = []

    for i, r in enumerate(rows):
        try:
            # normalize keys (allow variants)
            state = r.get("state") or r.get("State") or "Unknown"
            district = r.get("district") or r.get("District") or "Unknown"
            village = r.get("village") or r.get("Village") or None
            patta_holder = r.get("patta_holder") or r.get("Patta Holder") or r.get("patta holder") or None
            land_area = r.get("land_area") or r.get("area") or r.get("Land Area") or None
            status = (r.get("status") or "Pending")
            date = r.get("date") or None

            lat = r.get("lat")
            lon = r.get("lon")
            try:
                lat_val = float(lat) if lat not in (None, "", "nan") else None
            except Exception:
                lat_val = None
            try:
                lon_val = float(lon) if lon not in (None, "", "nan") else None
            except Exception:
                lon_val = None

            payload = {
                "state": state,
                "district": district,
                "village": village,
                "patta_holder": patta_holder,
                "land_area": land_area,
                "status": status if status in ("Pending", "Granted") else "Pending",
                "date": date,
                "lat": lat_val,
                "lon": lon_val,
                "source": "import-json",
                "raw_ocr": json.dumps({"source": "import-json", "row": r}),

                # ✅ OFFICER ACCOUNTABILITY FIELDS (FIX)
                "assigned_officer_id": officer_id,
                "assigned_date": now_iso,
                "last_status_update": now_iso,
            }

            if payload["status"] == "Granted":
              payload["closed_date"] = now_iso


            # --- Try helper insert first ---
            try:
                created_claim = await insert_claim(payload)
                if created_claim:
                    created.append(created_claim)
                    continue
            except Exception as e_insert:
                errors.append({
                    "row": i + 1,
                    "error": f"insert_claim failed: {str(e_insert)}",
                    "trace": traceback.format_exc()
                })

            # --- Fallback direct SQL insert (WITH officer fields) ---
            try:
                async with db.begin():
                    q = sa_text("""
    INSERT INTO claims (
     state, district, block, village,
     patta_holder, address, land_area, status, date,
     lat, lon, source, raw_ocr,
     assigned_officer_id, assigned_date, last_status_update,
     closed_date,
     created_at
     )
    VALUES (
        :state, :district, NULL, :village,
        :patta_holder, NULL, :land_area, :status, :date,
        :lat, :lon, :source, :raw_ocr,
        :assigned_officer_id, :assigned_date, :last_status_update,
        :closed_date,
        datetime('now')
    )
""")
                    params = {
                        "state": payload["state"],
                        "district": payload["district"],
                        "village": payload["village"],
                        "patta_holder": payload["patta_holder"],
                        "land_area": payload["land_area"],
                        "status": payload["status"],
                        "date": payload["date"],
                        "lat": payload["lat"],
                        "lon": payload["lon"],
                        "source": payload["source"],
                        "raw_ocr": payload["raw_ocr"],
                        "assigned_officer_id": officer_id,
                        "assigned_date": now_iso,
                        "last_status_update": now_iso,
                        "closed_date": payload.get("closed_date"),
                    }

                    await db.execute(q, params)

                    # fetch last inserted row
                    res = await db.execute(sa_text("SELECT last_insert_rowid() AS id"))
                    row = res.fetchone()
                    new_id = row[0] if row else None

                    if new_id:
                        res2 = await db.execute(sa_text(
                            """
                            SELECT id,state,district,block,village,patta_holder,address,
                                   land_area,status,date,lat,lon,source,raw_ocr,
                                   assigned_officer_id,assigned_date,last_status_update,
                                   created_at
                            FROM claims WHERE id=:id
                            """
                        ), {"id": new_id})
                        new_row = res2.fetchone()
                        if new_row:
                            try:
                                created.append(dict(new_row))
                            except Exception:
                                created.append({"id": new_id})

            except Exception as e_sql:
                errors.append({
                    "row": i + 1,
                    "error": f"direct insert failed: {str(e_sql)}",
                    "trace": traceback.format_exc()
                })

        except Exception as outer:
            errors.append({
                "row": i + 1,
                "error": str(outer),
                "trace": traceback.format_exc()
            })

    return {
        "success": True,
        "count": len(created),
        "errors": errors,
        "claims": created
    }

# -------------------------
# Parse Excel (preview-only) endpoint (added)
# -------------------------
@router.post("/claims/parse-excel", tags=["claims"])
async def parse_excel(file: UploadFile = File(...)):
    """
    Accept an Excel (.xlsx/.xls/.csv), parse rows and return JSON for client-side review.
    Does NOT insert into DB.
    Response: { filename: "<tmp>", rows: [ {state,district,village,patta_holder,land_area,status,date,lat,lon}, ... ], errors: [] }
    """
    try:
        ext = PPath(file.filename).suffix.lower() if file.filename else ""
        tmp_name = f"{uuid.uuid4().hex}{ext or '.xlsx'}"
        tmp_path = TEMP_UPLOAD_DIR / tmp_name
        with open(tmp_path, "wb") as f:
            f.write(await file.read())

        # Read with pandas (openpyxl must be installed)
        if ext == ".csv" or (file.filename and file.filename.lower().endswith(".csv")):
            df = pd.read_csv(tmp_path)
        else:
            df = pd.read_excel(tmp_path, engine="openpyxl")

        # Normalize expected columns (lowercase keys)
        expected = ["state","district","village","patta_holder","land_area","status","date","lat","lon"]
        rows = []
        errors = []
        for idx, r in df.fillna("").iterrows():
            try:
                row = {}
                for col in expected:
                    # best-effort mapping: try exact first, then lower-case matching
                    if col in df.columns:
                        val = r[col]
                    else:
                        # try to find by lower-case column
                        matched = None
                        for cc in df.columns:
                            if cc.strip().lower() == col:
                                matched = cc; break
                            if cc.strip().lower().replace(" ","_") == col:
                                matched = cc; break
                        val = r[matched] if matched else ""
                    # final cast to string / numeric
                    if pd.isna(val):
                        val = ""
                    row[col] = val
                rows.append(row)
            except Exception as e:
                errors.append({"row": int(idx), "error": str(e)})
        return {"filename": tmp_name, "rows": rows, "errors": errors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -------------------------
# OCR / NER temp-file endpoints (parse + commit)
# -------------------------

@router.post("/claims/parse-fra", tags=["claims"])
async def parse_fra(file: UploadFile = File(...)):
    """
    Accept a file, run OCR+NER and return the structured extraction without inserting.
    Returns:
      { "filename": "<temp>", "extracted_text": "...", "entities": {...} }
    """
    try:
        # Save temp file with uuid to avoid name collisions
        ext = PPath(file.filename).suffix or ".pdf"
        tmp_name = f"{uuid.uuid4().hex}{ext}"
        tmp_path = TEMP_UPLOAD_DIR / tmp_name
        with open(tmp_path, "wb") as f:
            f.write(await file.read())

        text = extract_text(str(tmp_path))
        entities = extract_entities(text)

        return {"filename": tmp_name, "extracted_text": text, "entities": entities}
    except Exception as e:
        logger.exception("parse_fra failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


def _first(arr):
    if not arr:
        return None
    if isinstance(arr, (list, tuple)):
        return arr[0]
    return arr


def _clean_line(v):
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    # collapse whitespace
    return " ".join(s.split())


def _normalize_names(payload: Dict[str, Any]) -> Dict[str, Any]:
    # Minimal normalization: title-case state/district, leave village as-is
    p = dict(payload)
    if p.get("state"):
        p["state"] = _normalize_part(p["state"])
    if p.get("district"):
        p["district"] = _normalize_part(p["district"])
    # patta_holder keep as provided (strip)
    if p.get("patta_holder"):
        p["patta_holder"] = _clean_line(p["patta_holder"])
    return p


@router.post("/claims/commit-parsed", tags=["claims"])
async def commit_parsed(
    request: Request,            # ✅ ADD
    tmp_filename: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Commit a previously created temp file into the DB (runs exact same mapping as upload-fra).
    Client calls this after user reviews/edits fields and confirms. It will:
      - open uploads/temp/<tmp_filename>, extract text/entities (again or use provided edits),
      - create claim and return the created claim.
    NOTE: For simplicity this function re-runs extract_text/ner; you can adapt it to accept edited JSON from client instead)
    """
    try:
        tmp_path = TEMP_UPLOAD_DIR / tmp_filename
        if not tmp_path.exists():
            raise HTTPException(status_code=404, detail="Temp file not found")
        
        # ✅ identify logged-in officer
        user = await get_current_user(request)
        officer_id = user["id"]

        # run OCR+NER again (or you could accept edited JSON from client instead)
        text = extract_text(str(tmp_path))
        entities = extract_entities(text)

        # map fields conservatively (mirrors earlier mapping intent)
        state = _clean_line(entities.get("state") or _first(entities.get("states")))
        district = _clean_line(entities.get("district") or _first(entities.get("districts")))
        village = _clean_line(_first(entities.get("villages")))
        patta = _clean_line(_first(entities.get("patta_holders")))
        date_ = _clean_line(_first(entities.get("dates")))
        ifr_no = _clean_line(entities.get("ifr_number"))
        area = _clean_line(entities.get("land_area") or entities.get("area"))
        status = _clean_line(entities.get("status"))
        lat = entities.get("lat")
        lon = entities.get("lon")

        claim_payload = {
            "state": state or "Unknown",
            "district": district or "Unknown",
            "block": None,
            "village": village,
            "patta_holder": patta,
            "address": None,
            "land_area": area,
            "status": status or "Pending",
            "date": date_,
            "lat": float(lat) if isinstance(lat, (int, float, str)) and str(lat).strip() else None,
            "lon": float(lon) if isinstance(lon, (int, float, str)) and str(lon).strip() else None,
            "source": "ocr",
            "raw_ocr": json.dumps({"entities": entities, "extracted_text": text}),

            "assigned_officer_id": officer_id,
            "assigned_date": datetime.datetime.utcnow().isoformat(),
        }

        claim_payload = _normalize_names(claim_payload)

        # Use your existing db helper to insert
        created = await db.insert_claim(claim_payload)

        # upsert village entry for villages table
        try:
            await _upsert_village(
                state=claim_payload.get("state"),
                district=claim_payload.get("district"),
                village=claim_payload.get("village"),
                claimed_lat=claim_payload.get("lat"),
                claimed_lon=claim_payload.get("lon"),
            )
        except Exception as e:
            logger.warning("upsert village after commit_parsed failed: %s", e)

        # Optionally remove temp file after commit:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

        return {"claim": created}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("commit_parsed failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/claims/temp/{tmp_filename}", tags=["claims"])
async def delete_temp_file(tmp_filename: str):
    """
    Delete a temp file if user cancels.
    """
    try:
        tmp_path = TEMP_UPLOAD_DIR / tmp_filename
        if tmp_path.exists():
            tmp_path.unlink()
        return {"ok": True}
    except Exception as e:
        logger.exception("delete_temp_file failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
