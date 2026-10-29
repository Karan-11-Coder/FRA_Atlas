# backend/routes/claims.py
"""
FRA claims: CRUD, CSV export, Excel/CSV/JSON import, and the document-AI
intake flow (upload -> OCR -> NER -> review -> save).

The dashboard has no authentication by design; every route here is open.
Mounted under /api by main.py.
"""
import asyncio
import csv
import datetime
import io
import json
import logging
import os
import sqlite3
import time
import uuid
from pathlib import Path as PPath
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

import pandas as pd
from fastapi import APIRouter, Body, File, HTTPException, Path, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from backend import db
from backend.ner import entity_spans, extract_entities
from backend.ocr import extract_text
from backend.utils.normalize_claims import normalize_entities

router = APIRouter()
logger = logging.getLogger(__name__)

TEMP_UPLOAD_DIR = PPath("uploads/temp").resolve()
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

# India bounding box (lat_min, lon_min, lat_max, lon_max)
INDIA_BBOX: Tuple[float, float, float, float] = (6.0, 68.0, 37.5, 97.5)

# No DB-level CHECK constraints (adding one to a live SQLite table needs a
# rebuild), so values are validated here at the API boundary.
ALLOWED_CLAIM_STATUSES = {"Pending", "Granted", "Rejected"}
ALLOWED_CLAIM_TYPES = {"IFR", "CFR", "CR"}

EDITABLE_FIELDS = {"state", "district", "block", "village", "patta_holder", "address", "land_area",
                   "status", "date", "lat", "lon", "claim_type"}
EXPORT_COLUMNS = ["id", "state", "district", "block", "village", "patta_holder", "address", "land_area",
                  "claim_type", "status", "date", "lat", "lon", "source", "created_at"]


# -------------------------
# Helpers
# -------------------------
def _safe_temp_path(tmp_filename: str) -> PPath:
    """Resolve a client-supplied temp filename inside TEMP_UPLOAD_DIR, rejecting traversal."""
    candidate = (TEMP_UPLOAD_DIR / PPath(tmp_filename).name).resolve()
    try:
        candidate.relative_to(TEMP_UPLOAD_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if candidate == TEMP_UPLOAD_DIR:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return candidate


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    return content


def _normalize_part(s: Optional[str]) -> str:
    if not s:
        return ""
    return " ".join(str(s).strip().split()).title()


def _coords_plausible(lat, lon) -> bool:
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    lat_min, lon_min, lat_max, lon_max = INDIA_BBOX
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


def _validate(payload: Dict[str, Any]) -> None:
    if payload.get("status") and payload["status"] not in ALLOWED_CLAIM_STATUSES:
        raise HTTPException(status_code=400,
                            detail=f"Invalid status '{payload['status']}'. Must be one of {sorted(ALLOWED_CLAIM_STATUSES)}")
    if payload.get("claim_type"):
        payload["claim_type"] = str(payload["claim_type"]).upper()
        if payload["claim_type"] not in ALLOWED_CLAIM_TYPES:
            raise HTTPException(status_code=400,
                                detail=f"Invalid claim_type '{payload['claim_type']}'. Must be one of {sorted(ALLOWED_CLAIM_TYPES)}")
    if payload.get("land_area") not in (None, ""):
        try:
            payload["land_area"] = float(payload["land_area"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="land_area must be a number (hectares)")


async def _geocode_village(state: str, district: str, village: str) -> Optional[Tuple[float, float]]:
    """Nominatim lookup (polite 1.1 s delay), only used when a claim has no plausible coordinates."""
    query = f"{village}, {district}, {state}, India"
    url = "https://nominatim.openstreetmap.org/search?" + urlencode({"format": "json", "q": query})
    headers = {"User-Agent": os.getenv("NOMINATIM_USER_AGENT", "fra-atlas/2.0 (ml-dashboard)")}

    def _do():
        try:
            with urlopen(UrlRequest(url, headers=headers), timeout=10) as resp:
                arr = json.loads(resp.read().decode("utf-8"))
            return (float(arr[0]["lat"]), float(arr[0]["lon"])) if arr else None
        except Exception as e:
            logger.warning("Geocoding failed for %s | %s", query, e)
            return None

    await asyncio.sleep(1.1)
    return await run_in_threadpool(_do)


async def _upsert_village(state, district, village, lat, lon) -> None:
    """Make sure (state, district, village) is in `villages`, filling coordinates when known."""
    state, district, village = _normalize_part(state), _normalize_part(district), _normalize_part(village)
    if not (state and district and village):
        return
    try:
        async with db.engine.begin() as conn:
            existing = (await conn.execute(text(
                "SELECT id, lat, lon FROM villages WHERE state = :s AND district = :d AND village = :v"),
                {"s": state, "d": district, "v": village})).fetchone()
            if existing:
                if (existing[1] is None or existing[2] is None) and _coords_plausible(lat, lon):
                    await conn.execute(text("UPDATE villages SET lat = :lat, lon = :lon WHERE id = :id"),
                                       {"lat": float(lat), "lon": float(lon), "id": existing[0]})
                return
            ins_lat, ins_lon = (float(lat), float(lon)) if _coords_plausible(lat, lon) else (None, None)
            if ins_lat is None and os.getenv("GEOCODE_VILLAGES", "1") == "1":
                geo = await _geocode_village(state, district, village)
                if geo:
                    ins_lat, ins_lon = geo
            await conn.execute(text(
                "INSERT OR IGNORE INTO villages(state, district, village, lat, lon, created_at) "
                "VALUES (:s, :d, :v, :lat, :lon, datetime('now'))"),
                {"s": state, "d": district, "v": village, "lat": ins_lat, "lon": ins_lon})
    except Exception as e:
        logger.warning("upsert_village failed for %s/%s/%s: %s", state, district, village, e)


async def _create(payload: Dict[str, Any]) -> Dict[str, Any]:
    _validate(payload)
    now = db.utc_now_iso()
    payload.setdefault("status", "Pending")
    payload["last_status_update"] = now
    if payload.get("status") in ("Granted", "Rejected"):
        payload["closed_date"] = now
    created = await db.insert_claim(payload)
    await _upsert_village(payload.get("state"), payload.get("district"), payload.get("village"),
                          payload.get("lat"), payload.get("lon"))
    return created


def _sqlite(fn):
    """Run fn(conn) against the app database in a worker thread."""
    def _run():
        conn = sqlite3.connect(db.get_db_path())
        conn.row_factory = sqlite3.Row
        try:
            return fn(conn)
        finally:
            conn.close()
    return run_in_threadpool(_run)


# =========================
# CRUD
# =========================
@router.get("/claims", tags=["claims"])
async def get_claims(state: Optional[str] = None, district: Optional[str] = None, village: Optional[str] = None,
                     status: Optional[str] = None, q: Optional[str] = None,
                     limit: Optional[int] = Query(None, ge=1), offset: int = 0):
    """Claims, newest first. Optional filters: state, district, village (substring), status, q (free text)."""
    filters: Dict[str, Any] = {k: v for k, v in
                               {"state": state, "district": district, "village": village, "status": status, "q": q}.items() if v}
    if limit is not None:
        filters.update(limit=limit, offset=offset)
    return await db.query_claims(filters)


@router.get("/claims/count", tags=["claims"])
async def get_claims_count(village: str):
    return {"count": await db.count_claims_by_village(village)}


@router.get("/claims/{claim_id}", tags=["claims"])
async def get_claim(claim_id: int = Path(..., ge=1)):
    claim = await db.get_claim_by_id(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    return {"claim": claim}


@router.post("/claims", tags=["claims"])
async def create_claim(payload: dict = Body(...)):
    """Create a claim. Required: state, district, village."""
    for field in ("state", "district", "village"):
        if not payload.get(field):
            raise HTTPException(status_code=400, detail=f"{field} is required")
    payload = {k: v for k, v in payload.items() if k in EDITABLE_FIELDS | {"source", "raw_ocr"}}
    payload.setdefault("source", "manual")
    return {"success": True, "claim": await _create(payload)}


class ClaimUpdate(BaseModel):
    village: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    block: Optional[str] = None
    patta_holder: Optional[str] = None
    address: Optional[str] = None
    land_area: Optional[float] = None
    status: Optional[str] = None
    date: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    claim_type: Optional[str] = None


@router.put("/claims/{claim_id}", tags=["claims"])
async def update_claim(claim_id: int = Path(..., ge=1), payload: ClaimUpdate = Body(...)):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if k in EDITABLE_FIELDS}
    existing = await db.get_claim_by_id(claim_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Claim not found")
    if not updates:
        return existing
    _validate(updates)
    if "status" in updates:
        updates["last_status_update"] = db.utc_now_iso()
        updates["closed_date"] = updates["last_status_update"] if updates["status"] in ("Granted", "Rejected") else None

    def _update(conn):
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE claims SET {sets} WHERE id = ?", [*updates.values(), claim_id])
        conn.commit()
    await _sqlite(_update)
    updated = await db.get_claim_by_id(claim_id)
    await _upsert_village(updated.get("state"), updated.get("district"), updated.get("village"),
                          updated.get("lat"), updated.get("lon"))
    return updated


@router.delete("/claims/{claim_id}", tags=["claims"])
async def delete_claim(claim_id: int = Path(..., ge=1)):
    async with db.engine.begin() as conn:
        found = (await conn.execute(text("SELECT id FROM claims WHERE id = :id"), {"id": claim_id})).fetchone()
        if not found:
            raise HTTPException(status_code=404, detail="Claim not found")
        await conn.execute(text("DELETE FROM claims WHERE id = :id"), {"id": claim_id})
    return Response(status_code=204)


@router.delete("/claims", tags=["claims"])
async def bulk_delete_claims(ids: Optional[str] = Query(None, description="Comma separated ids, e.g. ?ids=1,2,3"),
                             payload: Optional[dict] = Body(None), confirm: bool = Query(False)):
    """Bulk delete: pass confirm=true and ids via ?ids=1,2 or JSON body {"ids": [...]}."""
    if not confirm:
        raise HTTPException(status_code=400, detail="Bulk delete not confirmed. Use ?confirm=true")
    try:
        id_list = [int(x) for x in ids.split(",") if x.strip()] if ids else [int(x) for x in (payload or {}).get("ids", [])]
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid ids")
    if not id_list:
        raise HTTPException(status_code=400, detail="No ids provided")
    placeholders = ",".join(f":id{i}" for i in range(len(id_list)))
    async with db.engine.begin() as conn:
        await conn.execute(text(f"DELETE FROM claims WHERE id IN ({placeholders})"),
                           {f"id{i}": v for i, v in enumerate(id_list)})
    return {"deleted": len(id_list)}


def _csv_cell(v) -> str:
    """Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell)."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") and not _is_number(s) else s


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


@router.get("/export/claims.csv", tags=["claims"])
async def export_claims_csv():
    rows = await db.query_claims({})
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_COLUMNS)
    for r in rows:
        w.writerow([_csv_cell(r.get(c)) for c in EXPORT_COLUMNS])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=claims.csv"})


# =========================
# Spreadsheet import
# =========================
COLUMN_ALIASES = {
    "state": ("state", "st", "province"),
    "district": ("district", "dist"),
    "village": ("village", "village_name", "gram"),
    "patta_holder": ("patta_holder", "pattaholder", "patta holder", "name", "claimant"),
    "land_area": ("land_area", "land area", "area", "hectares", "ha"),
    "claim_type": ("claim_type", "claim type", "type"),
    "status": ("status", "claim_status"),
    "date": ("date", "claim_date", "application_date"),
    "lat": ("lat", "latitude"),
    "lon": ("lon", "lng", "longitude"),
}


def _read_sheet(name: str, content: bytes) -> pd.DataFrame:
    try:
        if name.lower().endswith(".csv"):
            return pd.read_csv(io.BytesIO(content))
        return pd.read_excel(io.BytesIO(content), engine="openpyxl")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read spreadsheet: {e}")


def _sheet_rows(df: pd.DataFrame) -> List[Dict[str, Any]]:
    lookup = {str(c).strip().lower(): c for c in df.columns}
    colmap = {f: next((lookup[a] for a in aliases if a in lookup), None) for f, aliases in COLUMN_ALIASES.items()}
    rows = []
    for _, r in df.iterrows():
        row = {}
        for f, c in colmap.items():
            v = None if c is None or pd.isna(r.get(c)) else r.get(c)
            row[f] = v.item() if hasattr(v, "item") else v
        rows.append(row)
    return rows


@router.post("/claims/parse-excel", tags=["claims"])
async def parse_excel(file: UploadFile = File(...)):
    """Parse .xlsx/.csv rows for review without saving."""
    df = _read_sheet(file.filename or "", await _read_upload(file))
    return {"rows": _sheet_rows(df), "errors": []}


async def _import_rows(rows: List[Dict[str, Any]], source: str) -> Dict[str, Any]:
    created, errors = [], []
    for i, r in enumerate(rows):
        try:
            payload = {k: r.get(k) for k in EDITABLE_FIELDS if r.get(k) not in (None, "")}
            payload.setdefault("state", "Unknown")
            payload.setdefault("district", "Unknown")
            for k in ("lat", "lon"):
                if k in payload:
                    payload[k] = float(payload[k])
            if payload.get("status") and payload["status"] not in ALLOWED_CLAIM_STATUSES:
                payload["status"] = "Pending"
            payload.update(source=source, raw_ocr=json.dumps({"source": source, "row": r}, default=str))
            created.append(await _create(payload))
        except HTTPException as e:
            errors.append({"row": i + 1, "error": e.detail})
        except Exception as e:
            errors.append({"row": i + 1, "error": str(e)})
    return {"success": True, "count": len(created), "claims": created, "errors": errors}


@router.post("/claims/import-excel", tags=["claims"])
async def import_excel(file: UploadFile = File(...)):
    df = _read_sheet(file.filename or "", await _read_upload(file))
    return await _import_rows(_sheet_rows(df), "excel")


@router.post("/claims/import-json", tags=["claims"])
async def import_json(body: dict = Body(...)):
    rows = body.get("rows")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="Missing 'rows' array")
    return await _import_rows(rows, "import-json")


# =========================
# Document AI intake: upload -> OCR -> NER -> review -> save
# =========================
@router.post("/claims/parse-fra", tags=["claims"])
async def parse_fra(file: UploadFile = File(...)):
    """
    OCR + NER on an uploaded PDF, without saving a claim. Returns the text,
    highlighted entity spans (regex vs spaCy), the raw entities, the suggested
    claim fields to review, and timings. The file is kept in uploads/temp
    until commit-parsed or the temp delete route.
    """
    ext = PPath(file.filename or "").suffix.lower() or ".pdf"
    if ext != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF documents are supported for OCR")
    tmp_name = f"{uuid.uuid4().hex}{ext}"
    tmp_path = TEMP_UPLOAD_DIR / tmp_name
    tmp_path.write_bytes(await _read_upload(file))

    t0 = time.perf_counter()
    text_ = await run_in_threadpool(extract_text, str(tmp_path))
    t1 = time.perf_counter()
    entities = await run_in_threadpool(extract_entities, text_)
    spans = await run_in_threadpool(entity_spans, text_)
    t2 = time.perf_counter()
    candidates = normalize_entities(entities)
    fields = {k: v for k, v in (candidates[0] if candidates else {}).items() if k in EDITABLE_FIELDS}
    return {
        "filename": tmp_name,
        "original_name": file.filename,
        "extracted_text": text_,
        "spans": spans,
        "entities": {k: v for k, v in entities.items() if k != "raw_entities"},
        "fields": fields,
        "timing_ms": {"ocr": round((t1 - t0) * 1000), "ner": round((t2 - t1) * 1000)},
        "text_found": text_ != "NO_TEXT_EXTRACTED",
    }


class CommitParsed(BaseModel):
    tmp_filename: str
    fields: Dict[str, Any]


@router.post("/claims/commit-parsed", tags=["claims"])
async def commit_parsed(body: CommitParsed):
    """
    Save a reviewed extraction as a claim. Saves the fields exactly as the
    reviewer sent them (it used to re-run OCR and discard the edits), keeps
    the OCR text and entities in raw_ocr for provenance, and deletes the temp file.
    """
    tmp_path = _safe_temp_path(body.tmp_filename)
    if not tmp_path.exists():
        raise HTTPException(status_code=404, detail="Temp file not found (it may already have been saved)")
    payload = {k: v for k, v in body.fields.items() if k in EDITABLE_FIELDS and v not in (None, "")}
    for field in ("state", "district", "village"):
        if not payload.get(field):
            raise HTTPException(status_code=400, detail=f"{field} is required")
    text_ = await run_in_threadpool(extract_text, str(tmp_path))
    payload.update(source="ocr", raw_ocr=json.dumps({"extracted_text": text_, "reviewed_fields": body.fields}, default=str))
    created = await _create(payload)
    tmp_path.unlink(missing_ok=True)
    return {"claim": created}


@router.delete("/claims/temp/{tmp_filename}", tags=["claims"])
async def delete_temp_file(tmp_filename: str):
    tmp_path = _safe_temp_path(tmp_filename)
    if tmp_path.exists():
        tmp_path.unlink()
    return {"ok": True}
