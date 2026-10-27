"""
backfill_missing_features.py

Re-fetches ONLY the missing soil/elevation values in raw_features.csv --
does not touch rows that already succeeded, and does not touch
distance_to_water_km (expected to be null, unrelated to this gap).

Paced deliberately slower than the original bulk build (a configurable
sleep between each row's requests) to avoid repeating whatever rate-limit
or load issue caused the original ~25-29% failure rate.
"""

import argparse
import csv
import time
from pathlib import Path

from backend.services.geo_features import fetch_soil, fetch_elevation

SOIL_FIELDS = ["soil_ph", "soil_organic_carbon", "soil_clay_pct"]


def _is_missing(row: dict, field: str) -> bool:
    v = row.get(field)
    return v is None or v == "" or v == "None"


def backfill(in_path: str, out_path: str, sleep_between: float = 1.0,
             retries: int = 5, timeout: int = 30, checkpoint_every: int = 25):
    in_file = Path(in_path)
    with open(in_file, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = reader.fieldnames

    to_fix = [
        r for r in rows
        if any(_is_missing(r, f) for f in SOIL_FIELDS) or _is_missing(r, "elevation_m")
    ]
    print(f"Found {len(to_fix)}/{len(rows)} rows needing backfill.")

    fixed_soil = 0
    fixed_elev = 0
    still_missing = 0

    for i, row in enumerate(to_fix, 1):
        lat, lon = float(row["lat"]), float(row["lon"])

        if any(_is_missing(row, f) for f in SOIL_FIELDS):
            soil = fetch_soil(lat, lon, retries=retries, timeout=timeout)
            for f in SOIL_FIELDS:
                if soil.get(f) is not None:
                    row[f] = soil[f]
            if soil.get("soil_ph") is not None:
                fixed_soil += 1

        if _is_missing(row, "elevation_m"):
            elev = fetch_elevation(lat, lon, timeout=timeout)
            if elev.get("elevation_m") is not None:
                row["elevation_m"] = elev["elevation_m"]
                fixed_elev += 1

        if any(_is_missing(row, f) for f in SOIL_FIELDS) or _is_missing(row, "elevation_m"):
            still_missing += 1

        if i % checkpoint_every == 0:
            print(f"  ...{i}/{len(to_fix)} backfill attempts done "
                  f"(soil fixed: {fixed_soil}, elevation fixed: {fixed_elev}, "
                  f"still missing something: {still_missing})")

        time.sleep(sleep_between)

    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done. soil fixed: {fixed_soil}/{len(to_fix)}, "
          f"elevation fixed: {fixed_elev}/{len(to_fix)}, "
          f"rows still missing something after backfill: {still_missing}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", type=str, default="raw_features.csv")
    parser.add_argument("--out", type=str, default="raw_features_backfilled.csv")
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    start = time.time()
    backfill(args.in_path, args.out, sleep_between=args.sleep, retries=args.retries, timeout=args.timeout)
    print(f"Elapsed: {time.time() - start:.1f}s")
