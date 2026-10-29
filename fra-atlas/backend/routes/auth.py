# backend/routes/auth.py
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr, constr
from datetime import datetime, timedelta
import os
import sqlite3
from pathlib import Path
from jose import jwt, JWTError
from passlib.context import CryptContext
from typing import Optional
from starlette.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer
from dotenv import load_dotenv

# Load here rather than relying on main.py having done it first — main.py
# imports this module before it calls load_dotenv(), so without this,
# JWT_SECRET below reads as unset even when backend/.env exists.
#
# Pass the path explicitly (this file lives in backend/routes/, so .env is
# one level up) rather than a bare load_dotenv(): its default frame-based
# path detection breaks inside uvicorn --reload's spawned subprocess on
# Windows and silently finds nothing, which crashed this module's JWT_SECRET
# check below on every --reload run. load_dotenv() never overrides an
# already-set env var, so this is also a harmless no-op on the normal path
# where main.py's own explicit-path load already ran first.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

security = HTTPBearer()

router = APIRouter()

# -----------------------------
# Config
# -----------------------------
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET is not set. Define it in backend/.env (see backend/.env.example) "
        "before starting the server — there is no insecure fallback."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "120"))

# Use the same DB path resolution as backend/db.py so auth never opens a
# different database file than the rest of the app (see get_db_path()).
from backend.db import get_db_path

# Robust password hashing/verification:
# - verify existing raw bcrypt hashes ($2b$…)
# - generate new hashes using bcrypt_sha256 (no 72-byte pw limit)
pwd_ctx = CryptContext(
    schemes=["bcrypt_sha256", "bcrypt"],
    default="bcrypt_sha256",
    deprecated=["bcrypt"],
    bcrypt__ident="2b",
    bcrypt__truncate_error=False,  # don't raise if someone submits >72 bytes to raw bcrypt
)

# -----------------------------
# Models
# -----------------------------
class LoginIn(BaseModel):
    # use EmailStr if your usernames are emails; fall back to str if not
    username: EmailStr | str
    # bcrypt's raw backend only accepts up to 72 bytes; bcrypt_sha256 is fine with longer,
    # but we still keep a sane max to avoid abuse. Adjust if needed.
    password: constr(min_length=1, max_length=256)

# -----------------------------
# DB helpers
# -----------------------------
def get_db_conn():
    conn = sqlite3.connect(get_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

async def get_user_by_username(username: str):
    def _q():
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(
            # Deactivated officers (is_active = 0) are treated as unknown: they
            # can't log in, and tokens issued before deactivation stop working.
            "SELECT id, username, hashed_password, full_name, role FROM officers "
            "WHERE username = ? AND COALESCE(is_active, 1) = 1",
            (username,),
        )
        row = cur.fetchone()
        conn.close()
        return row
    row = await run_in_threadpool(_q)
    return row

# -----------------------------
# Password helpers
# -----------------------------
def hash_password(plain: str) -> str:
    """Use bcrypt_sha256 for new hashes."""
    return pwd_ctx.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify password against stored hash.

    If the stored hash is old raw bcrypt ($2b$...), avoid exceptions on >72-byte
    inputs by rejecting cleanly. New bcrypt_sha256 hashes aren't affected.
    """
    try:
        if isinstance(hashed, str) and hashed.startswith("$2b$"):
            # old raw-bcrypt hash path: reject overlong inputs cleanly
            if len(plain.encode("utf-8")) > 72:
                return False
        return pwd_ctx.verify(plain, hashed)
    except Exception:
        # Any unexpected crypto error -> treat as invalid
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

# -----------------------------
# Routes
# -----------------------------
@router.post("/login")
async def login(payload: LoginIn):
    row = await get_user_by_username(str(payload.username))
    if not row:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    hashed = row["hashed_password"]
    if not verify_password(payload.password, hashed):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    user = {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "full_name": row["full_name"],
    }
    token = create_access_token({
    "sub": row["username"],
    "role": row["role"],
    "officer_id": row["id"]
})

    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": user,
    }

async def get_current_user(request: Request):
    auth: str = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token = auth.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        username = payload.get("sub")
        officer_id = payload.get("officer_id")
        role = payload.get("role")

        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    row = await get_user_by_username(username)
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return {
    "id": officer_id,
    "username": username,
    "role": payload.get("role")
}

@router.get("/me", dependencies=[Depends(security)])
async def me(request: Request):
    """
    Returns the currently authenticated officer (based on bearer token).
    """
    user = await get_current_user(request)

    row = await get_user_by_username(user["username"])
    if not row:
        raise HTTPException(status_code=401, detail="User not found")

    try:
        row_dict = dict(row)
    except Exception:
        row_dict = {k: row[k] for k in row.keys()}

    return {
        "user": {
            "id": row_dict.get("id"),
            "username": row_dict.get("username"),
            "full_name": row_dict.get("full_name"),
            "role": row_dict.get("role"),
        }
    }


async def get_current_tribal_user(request: Request):
    """
    Auth dependency for tribal-claimant JWTs (issued by
    routes/auth_tribal.py::verify_otp). Separate from get_current_user()
    because tribal claimants aren't rows in the officers table — this only
    verifies the token's signature/expiry and its role claim, it doesn't
    look anything up in the DB.

    Returns {"identifier": <mobile or Aadhaar value>, "method": "mobile"|"aadhaar"}.
    """
    auth: str = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token = auth.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if payload.get("role") != "tribal":
        raise HTTPException(status_code=403, detail="Not a tribal-claimant token")
    identifier = payload.get("sub")
    if not identifier:
        raise HTTPException(status_code=401, detail="Invalid token")

    return {"identifier": identifier, "method": payload.get("method")}
