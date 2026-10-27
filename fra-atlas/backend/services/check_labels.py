"""
check_labels.py

Health report for a labeled dataset. Re-run it after ANY change to
scheme_rules.py or the input features, before training anything.

    python -m backend.services.check_labels --in labeled_dataset.csv

For each label it recomputes the noiseless rule value (the "base") for every
row, which gives the label's real learnable signal and therefore the best R^2
any model could possibly reach. A model scoring near that ceiling has
recovered the rule; one scoring near zero on a label with a near-zero ceiling
is behaving correctly, not failing.
"""

import argparse
import csv
import statistics as st

from backend.services.generate_labels import _coerce
from backend.services.scheme_rules import NOISE_SD, SCORERS, score_row

FEATURES = [
    "lat", "lon", "land_area_ha", "soil_ph", "soil_organic_carbon",
    "soil_clay_pct", "elevation_m", "groundwater_stress_pct",
    "rainfall_mm_avg", "is_scheduled_area", "claim_type",
]
WEAK_CEILING = 0.25


class _NoNoise:
    """Stands in for random.Random so the scorers return their noiseless base."""

    def gauss(self, mu, sigma):
        return mu


def main(in_path: str):
    with open(in_path, newline="") as f:
        raw = list(csv.DictReader(f))
    rows = [_coerce(r) for r in raw]
    n = len(rows)
    score_cols = list(SCORERS)

    ids = [r["plot_id"] for r in raw]
    print(f"rows: {n} | duplicate plot_id: {n - len(set(ids))}")

    empties = {c: sum(1 for r in raw if r.get(c) in (None, "")) for c in raw[0]}
    nonzero = {c: k for c, k in empties.items() if k}
    print("empty cells per column:", nonzero if nonzero else "none (distance_to_water_km excluded)")

    print("\n-- score ranges --")
    for c in score_cols:
        vals = [float(r[c]) for r in raw]
        print(f"{c:<24} min {min(vals):6.2f}  max {max(vals):6.2f}  mean {st.mean(vals):6.2f}")

    print("\n-- learnable signal per label --")
    print(f"{'label':<24}{'Var(y)':>8}{'noise_sd':>9}{'signal_sd':>10}{'levels':>8}{'R2 ceiling':>11}  verdict")
    bases = {}
    for c in score_cols:
        base = [score_row(r, _NoNoise())[c] for r in rows]
        bases[c] = base
        y = [float(r[c]) for r in raw]
        var_y = st.pvariance(y)
        var_b = st.pvariance(base)
        # Expected R^2 of a model that knows the rule exactly: signal variance
        # over signal + noise variance (stable, unlike var_b / observed var_y).
        ceiling = var_b / (var_b + NOISE_SD[c] ** 2)
        verdict = "WEAK - mostly noise" if ceiling < WEAK_CEILING else "ok"
        print(f"{c:<24}{var_y:>8.1f}{NOISE_SD[c]:>9.1f}{var_b ** 0.5:>10.2f}"
              f"{len(set(round(b, 4) for b in base)):>8}{ceiling:>11.3f}  {verdict}")

    print("\n-- feature variation (constants carry no information) --")
    for c in FEATURES:
        if c in rows[0]:
            u = len({r[c] for r in rows})
            print(f"{c:<24}{u:>6} unique" + ("   <-- CONSTANT" if u == 1 else ""))

    print("\n-- label correlations |r| > 0.5 --")
    found = False
    for i, a in enumerate(score_cols):
        for b in score_cols[i + 1:]:
            r = st.correlation([float(x[a]) for x in raw], [float(x[b]) for x in raw])
            if abs(r) > 0.5:
                found = True
                print(f"{a} ~ {b}: {r:+.2f}")
    if not found:
        print("none")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", default="labeled_dataset.csv")
    main(ap.parse_args().in_path)
