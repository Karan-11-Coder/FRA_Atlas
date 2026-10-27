# backend/bulk_insert_villages.py
"""
Seed script for demo villages. Run from the fra-atlas/ root:
    venv/Scripts/python.exe -m backend.bulk_insert_villages

Goes straight through backend.services.villages.upsert_village against the
canonical async engine (backend.db.SessionLocal) — the same pattern every
other live module in this codebase uses. Previously this POSTed to
`/api/villages`, a route that never existed (only GET was implemented).
"""
import asyncio

from backend.db import SessionLocal
from backend.services.villages import upsert_village

VILLAGES = [
    {"state": "Madhya Pradesh", "district": "Shivpuri", "village": "Kailashpur", "lat": 25.4300, "lon": 77.6500},
    {"state": "Madhya Pradesh", "district": "Shivpuri", "village": "Rampur", "lat": 25.3500, "lon": 77.8000},
    {"state": "Madhya Pradesh", "district": "Chhindwara", "village": "Chhoti Bari", "lat": 22.0600, "lon": 79.1800},
    {"state": "Madhya Pradesh", "district": "Chhindwara", "village": "Beldih", "lat": 22.2000, "lon": 79.1500},
    {"state": "Odisha", "district": "Koraput", "village": "Koraput Basti", "lat": 18.8200, "lon": 82.7300},
    {"state": "Odisha", "district": "Koraput", "village": "Lamtapalli", "lat": 18.9000, "lon": 82.6500},
    {"state": "Odisha", "district": "Kandhamal", "village": "Kandha Tola", "lat": 20.4700, "lon": 84.0200},
    {"state": "Odisha", "district": "Kandhamal", "village": "Daringbadi", "lat": 20.3500, "lon": 84.0300},
    {"state": "Telangana", "district": "Warangal", "village": "Warangal Cheruvu", "lat": 17.9800, "lon": 79.5800},
    {"state": "Telangana", "district": "Warangal", "village": "Narsampet", "lat": 17.4300, "lon": 79.7300},
    {"state": "Telangana", "district": "Adilabad", "village": "Adilabad Peta", "lat": 19.6500, "lon": 78.5300},
    {"state": "Telangana", "district": "Adilabad", "village": "Sirpur", "lat": 19.4500, "lon": 78.4800},
    {"state": "Tripura", "district": "West", "village": "Agartala West End", "lat": 23.8300, "lon": 91.2800},
    {"state": "Tripura", "district": "West", "village": "Sadar Bazar", "lat": 23.8200, "lon": 91.2800},
]


async def main():
    async with SessionLocal() as session:
        for v in VILLAGES:
            try:
                await upsert_village(
                    session,
                    state=v["state"],
                    district=v["district"],
                    village=v["village"],
                    claimed_lat=v["lat"],
                    claimed_lon=v["lon"],
                )
                await session.commit()
                print(f"Upserted: {v['village']}")
            except Exception as e:
                await session.rollback()
                print(f"Failed: {v['village']} -> {e}")


if __name__ == "__main__":
    asyncio.run(main())
