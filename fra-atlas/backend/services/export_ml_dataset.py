"""
export_ml_dataset.py

Builds ml/data/labeled_dataset.csv from the repo-root labeled_dataset.csv:
  - drops distance_to_water_km  (null for every row: no water geometry yet)
  - drops is_scheduled_area     (True for every row: all four target states
                                 are Scheduled Areas, so it carries nothing)
  - adds spatial_block          (district + 0.3-degree grid cell, ~33 km)

spatial_block exists so a train/test split can keep nearby plots together.
36% of plots have another plot within 1 km, so a random split lets a model
see a test plot's neighbours in training. With 0.3-degree blocks (115 groups)
only ~7% of close pairs straddle a block edge. Use it with GroupKFold /
GroupShuffleSplit; group by `district` instead for a harsher test.

    python -m backend.services.export_ml_dataset
"""

import argparse
import csv
import math
from pathlib import Path

DROP = {"distance_to_water_km", "is_scheduled_area"}
BLOCK_DEGREES = 0.3


def spatial_block(row: dict) -> str:
    district = row["district"].lower().replace(" ", "_")
    return (
        f"{district}_{math.floor(float(row['lat']) / BLOCK_DEGREES)}"
        f"_{math.floor(float(row['lon']) / BLOCK_DEGREES)}"
    )


def export(in_path: str, out_path: str):
    with open(in_path, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        cols = [c for c in reader.fieldnames if c not in DROP]

    out_cols = []
    for c in cols:
        out_cols.append(c)
        if c == "lon":
            out_cols.append("spatial_block")

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=out_cols)
        w.writeheader()
        for r in rows:
            out = {c: r[c] for c in cols}
            out["spatial_block"] = spatial_block(r)
            w.writerow(out)

    n_blocks = len({spatial_block(r) for r in rows})
    print(f"Wrote {len(rows)} rows, {len(out_cols)} columns, {n_blocks} spatial blocks to {out_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", default="labeled_dataset.csv")
    ap.add_argument("--out", default="../ml/data/labeled_dataset.csv")
    a = ap.parse_args()
    export(a.in_path, a.out)
