# backend/scripts/create_officer.py
import sqlite3
import argparse
import sys
from pathlib import Path

# Run from repo root so `backend` resolves as a package (same convention as
# the rest of the app), then reuse the exact same hashing context as
# routes/auth.py and routes/officers.py — this used to have its own plain
# `bcrypt` CryptContext, which was the one place in the codebase not using
# bcrypt_sha256.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.routes.auth import hash_password
from backend.db import get_db_path, ensure_officers_table_sync

def create_officer(username, password, full_name="Admin User", role="admin"):
    hashed = hash_password(password)
    conn = sqlite3.connect(get_db_path())
    # Same schema the server creates on startup (backend/db.py), so a DB
    # seeded by this script before the server ever ran isn't missing columns.
    ensure_officers_table_sync(conn)
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO officers (username, hashed_password, full_name, role) VALUES (?, ?, ?, ?)",
                    (username, hashed, full_name, role))
        conn.commit()
        print("Inserted officer:", username)
    except sqlite3.IntegrityError:
        print("User already exists:", username)
    finally:
        conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--full_name", default="Admin User")
    parser.add_argument("--role", default="admin")
    args = parser.parse_args()
    create_officer(args.username, args.password, args.full_name, args.role)
