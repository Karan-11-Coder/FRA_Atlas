"""
build_dataset.py

Turns sampled coordinates into a raw feature table (raw_features.csv) --
one row per synthetic plot, every Tier-1 feature filled in. No scheme
scores here -- this stops at raw features only.
"""

import argparse
import csv
import random
import time
from pathlib import Path

from backend.services.sample_geography import sample_all_districts
from backend.services.geo_features import get_features

LAND_AREA_RANGE_HA = (0.2, 4.0)
CLAIM_TYPE_WEIGHTS = {"IFR": 0.55, "CR": 0.20, "CFR": 0.25}


def _random_land_area(rng):
    return round(rng.uniform(*LAND_AREA_RANGE_HA), 2)


def _random_claim_type(rng):
    types, weights = zip(*CLAIM_TYPE_WEIGHTS.items())
    return rng.choices(types, weights=weights, k=1)[0]


def build(points_per_district: int, out_path: str, seed: int = 42, checkpoint_every: int = 50):
    rng = random.Random(seed)
    plots = sample_all_districts(points_per_district=points_per_district, seed=seed)

    fieldnames = [
        "plot_id", "state", "district", "lat", "lon",
        "land_area_ha", "claim_type",
        "soil_ph", "soil_organic_carbon", "soil_clay_pct",
        "elevation_m", "distance_to_water_km",
        "groundwater_stress_pct", "rainfall_mm_avg", "is_scheduled_area",
    ]

    out_file = Path(out_path)
    with open(out_file, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for i, plot in enumerate(plots, 1):
            features = get_features(
                lat=plot["lat"], lon=plot["lon"],
                state=plot["state"], district=plot["district"],
            )
            row = {
                "plot_id": plot["plot_id"], "state": plot["state"], "district": plot["district"],
                "lat": plot["lat"], "lon": plot["lon"],
                "land_area_ha": _random_land_area(rng),
                "claim_type": _random_claim_type(rng),
                **{k: features[k] for k in [
                    "soil_ph", "soil_organic_carbon", "soil_clay_pct",
                    "elevation_m", "distance_to_water_km",
                    "groundwater_stress_pct", "rainfall_mm_avg", "is_scheduled_area",
                ]},
            }
            writer.writerow(row)
            if i % checkpoint_every == 0:
                f.flush()
                print(f"  ...{i}/{len(plots)} rows written")

    print(f"Done. Wrote {len(plots)} rows to {out_file.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--points-per-district", type=int, default=10)
    parser.add_argument("--out", type=str, default="raw_features.csv")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    start = time.time()
    build(args.points_per_district, args.out, seed=args.seed)
    print(f"Elapsed: {time.time() - start:.1f}s")
