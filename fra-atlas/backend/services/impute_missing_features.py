"""
impute_missing_features.py

Fills the ~506 rows in raw_features.csv still missing soil_ph /
soil_organic_carbon / soil_clay_pct / elevation_m (the live SoilGrids /
open-elevation calls failed for them, and a real re-fetch pass was
abandoned as impractically slow on the day this was run) using the
(state, district) mean of whichever rows in the SAME district DID get a
real value for that field. Falls back to the dataset-wide mean only if a
district has zero real values for a field (not expected to happen here,
but handled rather than left to crash).

HONESTY: these are statistical estimates from real neighboring data, not
real per-point measurements and not invented numbers either -- every
imputed cell is marked explicitly. Four new boolean columns
(`soil_ph_imputed`, `soil_organic_carbon_imputed`, `soil_clay_pct_imputed`,
`elevation_m_imputed`) record exactly which cells are real SoilGrids/
open-elevation readings (False) vs. this district-mean estimate (True), so
nothing downstream can mistake one for the other. distance_to_water_km is
untouched -- it is out of scope for this fix (no water geometry file
exists yet, a separate known gap).
"""

import argparse
import csv
import time
from collections import defaultdict
from pathlib import Path
from statistics import mean

IMPUTABLE_FIELDS = ["soil_ph", "soil_organic_carbon", "soil_clay_pct", "elevation_m"]


def _is_missing(row: dict, field: str) -> bool:
    v = row.get(field)
    return v is None or v == "" or v == "None"


def impute(in_path: str, out_path: str):
    in_file = Path(in_path)
    with open(in_file, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = list(reader.fieldnames) + [f"{f}_imputed" for f in IMPUTABLE_FIELDS]

    # Real values only, grouped by (state, district), per field.
    by_district = {field: defaultdict(list) for field in IMPUTABLE_FIELDS}
    by_global = {field: [] for field in IMPUTABLE_FIELDS}

    for row in rows:
        key = (row.get("state"), row.get("district"))
        for field in IMPUTABLE_FIELDS:
            if not _is_missing(row, field):
                val = float(row[field])
                by_district[field][key].append(val)
                by_global[field].append(val)

    district_means = {
        field: {key: round(mean(vals), 2) for key, vals in by_district[field].items()}
        for field in IMPUTABLE_FIELDS
    }
    global_means = {
        field: (round(mean(by_global[field]), 2) if by_global[field] else None)
        for field in IMPUTABLE_FIELDS
    }

    print("District means computed from real values, per field:")
    for field in IMPUTABLE_FIELDS:
        n_districts = len(district_means[field])
        print(f"  {field}: {n_districts} districts have real data, "
              f"global fallback mean = {global_means[field]}")

    counts_imputed = {field: 0 for field in IMPUTABLE_FIELDS}
    counts_fallback_global = {field: 0 for field in IMPUTABLE_FIELDS}

    for row in rows:
        key = (row.get("state"), row.get("district"))
        for field in IMPUTABLE_FIELDS:
            if _is_missing(row, field):
                est = district_means[field].get(key)
                if est is None:
                    est = global_means[field]
                    counts_fallback_global[field] += 1
                row[field] = est
                row[f"{field}_imputed"] = "True"
                counts_imputed[field] += 1
            else:
                row[f"{field}_imputed"] = "False"

    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print()
    print("Imputation summary:")
    for field in IMPUTABLE_FIELDS:
        print(f"  {field}: {counts_imputed[field]} rows imputed "
              f"({counts_fallback_global[field]} of those via global fallback, "
              f"no district data)")
    print(f"Wrote {len(rows)} rows to {Path(out_path).resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", type=str, default="raw_features.csv")
    parser.add_argument("--out", type=str, default="raw_features_backfilled.csv")
    args = parser.parse_args()
    start = time.time()
    impute(args.in_path, args.out)
    print(f"Elapsed: {time.time() - start:.2f}s")
