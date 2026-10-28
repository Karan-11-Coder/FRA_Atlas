# backend/scripts/seed_demo.py
"""
Seed a demo database: one demo officer, the reference villages, and a few
sample claims in each of the 7 districts the DSS model covers. Safe to run
repeatedly: existing rows are left alone.

Run from fra-atlas/:   python -m backend.scripts.seed_demo
(The Docker image runs it on start when SEED_DEMO=1.)

Demo officer:
  username  DEMO_OFFICER_USERNAME (default demo.officer@example.org)
  password  DEMO_OFFICER_PASSWORD if set; otherwise a random password is
            generated and printed ONCE, when the officer is first created.
            It is never stored anywhere except as a hash in the database.

All seeded claims are clearly synthetic: patta holders are "Demo Claimant NN"
and source is "demo-seed". Their coordinates are real SoilGrids-backed plots
from ml/data/labeled_dataset.csv, so the DSS can score them.
"""
import asyncio
import json
import os
import secrets
import sqlite3
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.db import (  # noqa: E402
    engine, ensure_officers_table_sync, get_db_path, init_claims_table, init_officers_table,
    init_villages_table, utc_now_iso,
)
from backend.models import Base  # noqa: E402
from backend.routes.auth import hash_password  # noqa: E402
from backend.services import ml_inference  # noqa: E402

DEMO_SOURCE = "demo-seed"
CLAIMS_PER_DISTRICT = 2
VILLAGE_RECORDS = Path(os.getenv(
    "VILLAGE_RECORDS_PATH",
    ml_inference.DISTRICT_GEOJSON_DIR.parent / "village_records.json",
))
STATUSES = ["Pending", "Granted", "Rejected", "Pending"]


async def _create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await init_claims_table()
    await init_villages_table()
    await init_officers_table()


def _seed_officer(conn) -> int:
    ensure_officers_table_sync(conn)
    username = os.getenv("DEMO_OFFICER_USERNAME") or "demo.officer@example.org"
    row = conn.execute("SELECT id FROM officers WHERE username = ?", (username,)).fetchone()
    if row:
        print(f"[seed] demo officer {username} already exists (password unchanged)")
        return row[0]

    password = os.getenv("DEMO_OFFICER_PASSWORD")
    generated = not password
    if generated:
        password = secrets.token_urlsafe(12)
    conn.execute(
        "INSERT INTO officers (username, hashed_password, full_name, role, district, is_active) VALUES (?, ?, ?, ?, ?, 1)",
        (username, hash_password(password), "Demo Officer", "admin", "Chhindwara"),
    )
    conn.commit()
    print(f"[seed] created demo officer {username} (role admin)")
    if generated:
        print("[seed] ==================================================================")
        print(f"[seed]  Generated demo password (shown once, not stored): {password}")
        print("[seed]  Set DEMO_OFFICER_PASSWORD in .env to choose your own instead.")
        print("[seed] ==================================================================")
    return conn.execute("SELECT id FROM officers WHERE username = ?", (username,)).fetchone()[0]


def _seed_villages(conn) -> int:
    if not VILLAGE_RECORDS.exists():
        print(f"[seed] {VILLAGE_RECORDS} not found; skipping villages")
        return 0
    added = 0
    for v in json.loads(VILLAGE_RECORDS.read_text(encoding="utf-8")):
        lon, lat = v["coordinates"]
        exists = conn.execute("SELECT 1 FROM villages WHERE state = ? AND district = ? AND village = ?",
                              (v["state"], v["district"], v["village"])).fetchone()
        if not exists:
            conn.execute("INSERT INTO villages (state, district, village, lat, lon, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                         (v["state"], v["district"], v["village"], lat, lon, utc_now_iso()))
            added += 1
    conn.commit()
    return added


def _seed_claims(conn, officer_id: int) -> int:
    if conn.execute("SELECT COUNT(*) FROM claims WHERE source = ?", (DEMO_SOURCE,)).fetchone()[0]:
        print("[seed] demo claims already present; skipping")
        return 0
    ref = pd.read_csv(ml_inference.REFERENCE_DATA_PATH)
    real = ref[~(ref.soil_ph_imputed.astype(bool) | ref.soil_organic_carbon_imputed.astype(bool))]
    now = utc_now_iso()
    n = 0
    for (state, district), g in real.groupby(["state", "district"]):
        for _, plot in g.sample(CLAIMS_PER_DISTRICT, random_state=42).iterrows():
            n += 1
            status = STATUSES[n % len(STATUSES)]
            conn.execute(
                """INSERT INTO claims (state, district, village, patta_holder, land_area, status, lat, lon, source,
                                       assigned_officer_id, assigned_date, last_status_update, closed_date, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (state, district, f"Demo plot {plot.plot_id}", f"Demo Claimant {n:02d}", float(plot.land_area_ha),
                 status, float(plot.lat), float(plot.lon), DEMO_SOURCE, officer_id, now, now,
                 now if status != "Pending" else None, now),
            )
    conn.commit()
    return n


def main():
    asyncio.run(_create_tables())
    conn = sqlite3.connect(get_db_path())
    try:
        officer_id = _seed_officer(conn)
        print(f"[seed] villages added: {_seed_villages(conn)}")
        print(f"[seed] demo claims added: {_seed_claims(conn, officer_id)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
