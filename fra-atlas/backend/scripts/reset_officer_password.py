# backend/scripts/reset_officer_password.py
"""
Reset an officer's password, create an officer, or deactivate one.

The new password is read from a hidden prompt (typed twice), so it never
appears on the command line, in shell history, in logs or in chat. For
non-interactive use (e.g. CI) it can come from the environment variable
OFFICER_NEW_PASSWORD instead. The password itself is never printed.

Run from fra-atlas/ (locally) or inside the backend container:
  python -m backend.scripts.reset_officer_password --username admin@gov.in
  python -m backend.scripts.reset_officer_password --username new@example.org --create --role case_officer --full-name "Name"
  python -m backend.scripts.reset_officer_password --username officer1@gov.in --deactivate
  docker compose exec backend python -m backend.scripts.reset_officer_password --username admin@gov.in

Changing JWT_SECRET (in .env) is what invalidates already-issued login
tokens; deactivating an officer also blocks that officer's existing tokens.
"""
import argparse
import getpass
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.db import ensure_officers_table_sync, get_db_path  # noqa: E402
from backend.routes.auth import hash_password  # noqa: E402

MIN_LENGTH = 12
ROLES = ("admin", "case_officer")


def read_new_password() -> str:
    pw = os.getenv("OFFICER_NEW_PASSWORD")
    if pw is None:
        if not sys.stdin.isatty():
            sys.exit("No terminal for the password prompt; set OFFICER_NEW_PASSWORD instead.")
        pw = getpass.getpass("New password: ")
        if pw != getpass.getpass("Repeat new password: "):
            sys.exit("Passwords don't match; nothing changed.")
    if len(pw) < MIN_LENGTH:
        sys.exit(f"Password must be at least {MIN_LENGTH} characters; nothing changed.")
    return pw


def run(username: str, create: bool = False, role: str = "case_officer", full_name: str = None,
        deactivate: bool = False, password: str = None) -> str:
    conn = sqlite3.connect(get_db_path())
    try:
        ensure_officers_table_sync(conn)
        row = conn.execute("SELECT id FROM officers WHERE username = ?", (username,)).fetchone()

        if deactivate:
            if not row:
                return f"No officer {username}; nothing to deactivate."
            conn.execute("UPDATE officers SET is_active = 0 WHERE username = ?", (username,))
            conn.commit()
            return f"Deactivated {username}: it can no longer log in and its existing tokens are rejected."

        if not row and not create:
            return f"No officer {username}. Use --create to add one."
        pw = password if password is not None else read_new_password()
        if row:
            conn.execute("UPDATE officers SET hashed_password = ?, is_active = 1 WHERE username = ?",
                         (hash_password(pw), username))
            msg = f"Password reset for {username} (account active)."
        else:
            conn.execute("INSERT INTO officers (username, hashed_password, full_name, role, is_active) VALUES (?, ?, ?, ?, 1)",
                         (username, hash_password(pw), full_name or username.split("@")[0], role))
            msg = f"Created {role} {username}."
        conn.commit()
        return msg
    finally:
        conn.close()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--username", required=True)
    p.add_argument("--create", action="store_true", help="create the officer if it doesn't exist")
    p.add_argument("--role", choices=ROLES, default="case_officer", help="role for --create")
    p.add_argument("--full-name")
    p.add_argument("--deactivate", action="store_true", help="block this officer from logging in")
    a = p.parse_args()
    print(f"Database: {get_db_path()}")
    print(run(a.username, create=a.create, role=a.role, full_name=a.full_name, deactivate=a.deactivate))


if __name__ == "__main__":
    main()
