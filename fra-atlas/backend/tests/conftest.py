"""
Test setup. Run from fra-atlas/:  python -m pytest backend/tests

DATABASE_URL must be set before any backend module is imported (db.py reads
it at import time). Geocoding is switched off so tests never call Nominatim.
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

FRA_ATLAS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FRA_ATLAS))

_TMP = Path(tempfile.mkdtemp(prefix="fra_atlas_test_"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["GEOCODE_VILLAGES"] = "0"
os.environ.pop("SEED_VILLAGES", None)

MOCK_DIR = FRA_ATLAS / "backend" / "mock_data"


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from backend.db import get_db_path
    from backend.main import app
    # Never let tests touch a real database file.
    assert Path(get_db_path()).resolve().is_relative_to(_TMP.resolve()), f"tests would write to {get_db_path()}"
    with TestClient(app) as c:      # runs startup: tables + model load
        yield c
