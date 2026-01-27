# backend/db.py
from typing import Any, Dict, List, Optional, Generator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker
import os
import datetime
from pathlib import Path
import logging
from typing import Any, Dict, List, Optional, AsyncGenerator

# ----------------------------
# DATABASE URL resolution (deterministic)
# ----------------------------
ENV_DATABASE_URL = os.getenv("DATABASE_URL")

if ENV_DATABASE_URL:
    DATABASE_URL = ENV_DATABASE_URL
else:
    BASE_DIR = Path(__file__).resolve().parent  # backend/
    DB_FILE = BASE_DIR / "fra_atlas.db"
    DATABASE_URL = f"sqlite+aiosqlite:///{DB_FILE.as_posix()}"

logging.getLogger().info(f"DEBUG: backend.db using DATABASE_URL = {DATABASE_URL}")
print("DEBUG: backend.db using DATABASE_URL =", DATABASE_URL, flush=True)

try:
    if isinstance(DATABASE_URL, str) and DATABASE_URL.startswith("sqlite"):
        candidate_file = DATABASE_URL.split(":///")[-1]
        print("DEBUG: resolved DB file path =", str(Path(candidate_file).resolve()), flush=True)
except Exception:
    pass

# ----------------------------
# Async engine + session factory
# ----------------------------
engine = create_async_engine(DATABASE_URL, echo=True, future=True)
SessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

# ----------------------------
# Utility: robust row -> dict mapper
# ----------------------------
def _row_to_dict(row) -> Dict[str, Any]:
    """
    Convert a SQLAlchemy Row or DBAPI row to a plain dict.
    Supports different SQLAlchemy versions where row may have ._mapping or indexing.
    """
    if row is None:
        return {}
    # SQLAlchemy Row has _mapping in modern versions
    try:
        if hasattr(row, "_mapping"):
            return dict(row._mapping)
    except Exception:
        pass
    # Fallback to treat row like a sequence of values + cursor description is unavailable here.
    try:
        return dict(row)
    except Exception:
        # As a last resort try iterating attributes
        try:
            return {k: getattr(row, k) for k in dir(row) if not k.startswith("_")}
        except Exception:
            return {}

# ----------------------------
# Claims table helpers
# ----------------------------
async def init_claims_table() -> None:
    """
    Create the claims table if it does not exist.
    Ensure new fields (source, raw_ocr) exist.
    """
    sql = """
    CREATE TABLE IF NOT EXISTS claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state TEXT,
        district TEXT,
        block TEXT,
        village TEXT,
        patta_holder TEXT,
        address TEXT,
        land_area TEXT,
        status TEXT,
        date TEXT,
        lat REAL,
        lon REAL,
        source TEXT DEFAULT 'manual',
        raw_ocr TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );
    """
    async with engine.begin() as conn:
        await conn.execute(text(sql))
        # Try adding new columns if table already existed (ignore errors)
        try:
            await conn.execute(text("ALTER TABLE claims ADD COLUMN source TEXT DEFAULT 'manual'"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE claims ADD COLUMN raw_ocr TEXT"))
        except Exception:
            pass


async def insert_claim(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Insert a claim and return the created row as a dict.
    Payload may omit optional fields; created_at defaults to now when not provided.
    """
    insert_sql = text(
        """
        INSERT INTO claims (
   state, district, block, village,
   patta_holder, address, land_area, status, date,
   lat, lon, source, raw_ocr,
   assigned_officer_id, assigned_date, last_status_update,
   closed_date,
   created_at
)
VALUES (
   :state, :district, :block, :village,
   :patta_holder, :address, :land_area, :status, :date,
   :lat, :lon, :source, :raw_ocr,
   :assigned_officer_id, :assigned_date, :last_status_update,
   :closed_date,
   datetime('now')
)
        """
    )
    params = {
    "state": payload.get("state"),
    "district": payload.get("district"),
    "block": payload.get("block"),
    "village": payload.get("village"),
    "patta_holder": payload.get("patta_holder"),
    "address": payload.get("address"),
    "land_area": payload.get("land_area"),
    "status": payload.get("status"),
    "date": payload.get("date"),
    "lat": payload.get("lat"),
    "lon": payload.get("lon"),
    "source": payload.get("source", "manual"),
    "raw_ocr": payload.get("raw_ocr"),

    # ✅ OFFICER TRACKING (CRITICAL)
    "assigned_officer_id": payload.get("assigned_officer_id"),
    "assigned_date": payload.get("assigned_date"),
    "last_status_update": payload.get("last_status_update"),
    "closed_date": payload.get("closed_date"),

    "created_at": payload.get("created_at", datetime.datetime.utcnow().isoformat()),
}


    async with engine.begin() as conn:
        # Perform insert
        await conn.execute(insert_sql, params)

        # Obtain last insert id in sqlite via last_insert_rowid()
        last_id_res = await conn.execute(text("SELECT last_insert_rowid() AS id"))
        # fetchone may return different shapes; handle robustly
        last_row = last_id_res.fetchone()
        last_id = None
        if last_row is None:
            last_id = None
        else:
            try:
                # try tuple-like access
                last_id = last_row[0]
            except Exception:
                try:
                    last_id = last_row._mapping.get("id")
                except Exception:
                    last_id = None

        if not last_id:
            # fallback: try to query by unique combination (best-effort) - but return empty if we can't determine id
            # For simplicity return empty dict if we cannot find last id
            return {}

        row_res = await conn.execute(text("SELECT * FROM claims WHERE id = :id"), {"id": last_id})
        fetched = row_res.fetchone()
        return _row_to_dict(fetched) if fetched else {}


async def query_claims(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Query claims with optional filters.
    """
    sql = "SELECT * FROM claims WHERE 1=1"
    params: Dict[str, Any] = {}

    if filters.get("state"):
        sql += " AND state = :state"; params["state"] = filters["state"]
    if filters.get("district"):
        sql += " AND district = :district"; params["district"] = filters["district"]
    if filters.get("village"):
        sql += " AND village LIKE :village"; params["village"] = f"%{filters['village']}%"
    if filters.get("status"):
        sql += " AND status = :status"; params["status"] = filters["status"]
    if filters.get("q"):
        sql += " AND (village LIKE :q OR patta_holder LIKE :q OR address LIKE :q)"
        params["q"] = f"%{filters['q']}%"

    sql += " ORDER BY created_at DESC"

    if filters.get("limit") is not None:
        params["limit"] = int(filters.get("limit"))
        params["offset"] = int(filters.get("offset", 0))
        sql += " LIMIT :limit OFFSET :offset"

    async with engine.begin() as conn:
        result = await conn.execute(text(sql), params)
        rows = result.fetchall()
        return [_row_to_dict(r) for r in rows]


async def count_claims_by_village(village: str) -> int:
    sql = "SELECT COUNT(*) AS cnt FROM claims WHERE village = :village"
    async with engine.begin() as conn:
        result = await conn.execute(text(sql), {"village": village})
        row = result.fetchone()
        if not row:
            return 0
        # robustly extract count
        try:
            # tuple-like
            return int(row[0])
        except Exception:
            try:
                return int(row._mapping.get("cnt", 0))
            except Exception:
                return 0


async def get_claim_by_id(claim_id: int) -> Optional[Dict[str, Any]]:
    async with engine.begin() as conn:
        row_res = await conn.execute(text("SELECT * FROM claims WHERE id = :id"), {"id": claim_id})
        r = row_res.fetchone()
        return _row_to_dict(r) if r else None

# ----------------------------
# Villages table helpers
# ----------------------------
async def init_villages_table() -> None:
    sql = """
    CREATE TABLE IF NOT EXISTS villages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state TEXT NOT NULL,
        district TEXT NOT NULL,
        block TEXT,
        village TEXT NOT NULL,
        lat REAL,
        lon REAL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    """
    async with engine.begin() as conn:
        await conn.execute(text(sql))


async def insert_village(payload: Dict[str, Any]) -> Dict[str, Any]:
    insert_sql = text(
        """
        INSERT INTO villages (state,district,block,village,lat,lon,created_at)
        VALUES (:state,:district,:block,:village,:lat,:lon,:created_at)
        """
    )
    params = {
        "state": payload.get("state"),
        "district": payload.get("district"),
        "block": payload.get("block"),
        "village": payload.get("village"),
        "lat": payload.get("lat"),
        "lon": payload.get("lon"),
        "created_at": payload.get("created_at", datetime.datetime.utcnow().isoformat()),
    }

    async with engine.begin() as conn:
        await conn.execute(insert_sql, params)
        last_row = await conn.execute(text("SELECT last_insert_rowid() AS id"))
        last = last_row.fetchone()
        last_id = None
        if last:
            try:
                last_id = last[0]
            except Exception:
                try:
                    last_id = last._mapping.get("id")
                except Exception:
                    last_id = None
        if not last_id:
            return {}
        row_res = await conn.execute(text("SELECT * FROM villages WHERE id = :id"), {"id": last_id})
        r = row_res.fetchone()
        return _row_to_dict(r) if r else {}

# ----------------------------
# FastAPI dependency
# ----------------------------
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session

# ----------------------------
# Sync DB path helper (for sqlite3-based modules)
# ----------------------------
from urllib.parse import urlparse

def get_db_path() -> str:
    """
    Return absolute filesystem path to the SQLite database file.
    Used by legacy sqlite3-based services (officer_metrics, credibility_engine).
    """
    url = urlparse(DATABASE_URL)

    # sqlite+aiosqlite:///C:/path/to/db.sqlite
    if url.scheme.startswith("sqlite"):
        return str(Path(url.path.lstrip("/")).resolve())

    raise RuntimeError("get_db_path() called for non-sqlite database")

