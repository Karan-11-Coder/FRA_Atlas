"""
Test setup. Run from fra-atlas/:  python -m pytest backend/tests

Env vars must be set before any backend module is imported: routes.auth
reads JWT_SECRET at import time, db.py reads DATABASE_URL, and
routes.auth_tribal reads MSG91_API_KEY (empty here, so OTPs stay in the
dev-mode in-memory path and no SMS is ever sent).
"""
import os
import secrets
import sqlite3
import sys
import tempfile
from pathlib import Path

import pytest

FRA_ATLAS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FRA_ATLAS))

_TMP = Path(tempfile.mkdtemp(prefix="fra_atlas_test_"))
os.environ["JWT_SECRET"] = secrets.token_hex(32)          # throwaway, per test run
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["MSG91_API_KEY"] = ""
os.environ.pop("SEED_VILLAGES", None)

TEST_PASSWORD = secrets.token_urlsafe(12)                  # generated per run, never stored


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from backend.db import get_db_path
    from backend.main import app
    from backend.routes import claims
    # Never let tests touch a real database file.
    for path in (get_db_path(), claims._get_default_db_path()):
        assert Path(path).resolve().is_relative_to(_TMP.resolve()), f"tests would write to {path}"
    with TestClient(app) as c:      # runs startup: tables + model load
        yield c


def _make_officer(username: str, role: str) -> int:
    from backend.db import ensure_officers_table_sync, get_db_path
    from backend.routes.auth import hash_password
    conn = sqlite3.connect(get_db_path())
    ensure_officers_table_sync(conn)
    conn.execute("INSERT OR IGNORE INTO officers (username, hashed_password, full_name, role) VALUES (?, ?, ?, ?)",
                 (username, hash_password(TEST_PASSWORD), username.split("@")[0], role))
    conn.commit()
    officer_id = conn.execute("SELECT id FROM officers WHERE username = ?", (username,)).fetchone()[0]
    conn.close()
    return officer_id


def _headers_for(username: str, role: str) -> dict:
    from backend.routes.auth import create_access_token
    officer_id = _make_officer(username, role)
    token = create_access_token({"sub": username, "role": role, "officer_id": officer_id})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def auth(client):
    """Bearer header for a case officer."""
    return _headers_for("officer@fra-atlas.test", "case_officer")


@pytest.fixture(scope="session")
def admin_auth(client):
    """Bearer header for an admin."""
    return _headers_for("admin@fra-atlas.test", "admin")
