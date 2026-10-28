"""
Test setup. Run from fra-atlas/:  python -m pytest backend/tests

Env vars must be set before any backend module is imported: routes.auth
reads JWT_SECRET at import time and db.py reads DATABASE_URL.
"""
import os
import secrets
import sys
import tempfile
from pathlib import Path

FRA_ATLAS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FRA_ATLAS))

_TMP = Path(tempfile.mkdtemp(prefix="fra_atlas_test_"))
os.environ["JWT_SECRET"] = secrets.token_hex(32)          # throwaway, per test run
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ.pop("SEED_VILLAGES", None)
