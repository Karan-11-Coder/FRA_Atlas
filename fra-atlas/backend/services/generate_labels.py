"""
generate_labels.py

Applies scheme_rules.py to every row of raw_features.csv and writes a
labeled dataset with 6 added score columns -- the Phase 5 deliverable.
"""

import argparse
import csv
import random
import time
from pathlib import Path

from backend.services.scheme_rules import score_row, SCORERS

NUMERIC_FIELDS = {
    "lat", "lon", "land_area_ha", "soil_ph", "soil_organic_carbon",
    "soil_clay_pct", "elevation_m", "distance_to_water_km",
    "groundwater_stress_pct", "rainfall_mm_avg",
}
BOOL_FIELDS = {"is_scheduled_area"}


def _coerce(row: dict) -> dict:
    out = dict(row)
    for k in NUMERIC_FIELDS:
        v = out.get(k)
        out[k] = float(v) if v not in (None, "", "None") else None
    for k in BOOL_FIELDS:
        v = out.get(k)
        out[k] = str(v).strip().lower() == "true"
    return out


def generate(in_path: str, out_path: str, seed: int = 42, checkpoint_every: int = 200):
    rng = random.Random(seed)
    in_file = Path(in_path)
    out_file = Path(out_path)

    with open(in_file, newline="") as f:
        reader = csv.DictReader(f)
        rows = [_coerce(r) for r in reader]
        fieldnames = list(reader.fieldnames) + list(SCORERS.keys())

    with open(out_file, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, row in enumerate(rows, 1):
            scores = score_row(row, rng)
            writer.writerow({**row, **scores})
            if i % checkpoint_every == 0:
                f.flush()
                print(f"  ...{i}/{len(rows)} rows labeled")

    print(f"Done. Wrote {len(rows)} labeled rows to {out_file.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", type=str, default="raw_features_backfilled.csv")
    parser.add_argument("--out", type=str, default="labeled_dataset.csv")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    start = time.time()
    generate(args.in_path, args.out, seed=args.seed)
    print(f"Elapsed: {time.time() - start:.1f}s")
