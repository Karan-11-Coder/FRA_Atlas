"""
scheme_rules.py

Rule-based scoring engine that generates the 6 scheme-score training labels
from raw_features.csv. Every formula here is grounded in real, sourced
numbers (CGWB categories, MGNREGA's 2025 water-works funding mandate, the
IWMP/PMKSY-Watershed 150-point matrix, PDMC subsidy tiers, Soil Health Card
official pH/OC bands) or explicitly flagged as an adapted/constructed proxy
where no scheme-native number exists. Full sourcing and reasoning per scheme
is in FRA_Atlas_Scoring_Methodology_Note.md -- do not change these formulas
without updating that note to match.

HONESTY NOTE: MGNREGA and JJM are not real per-plot eligibility scores --
MGNREGA is a universal household entitlement (this models work-priority
relevance, not "who qualifies"), and JJM prioritizes at habitation level
(this is an explicitly weak, wider-noise proxy). PM-KISAN and PMFBY are
close to binary gates dressed as scores. Only PMKSY and Soil Health Card
are genuinely multi-factor graded scores. See the methodology note before
presenting any of these as more precise than they are.
"""

import random


def _clip(x: float) -> float:
    return max(0.0, min(100.0, x))


def _gw_mandate_pct(groundwater_stress_pct: float) -> float:
    """CGWB category -> MGNREGA's real 23-Sep-2025 water-works funding mandate."""
    if groundwater_stress_pct is None:
        return 40.0  # neutral fallback if missing
    if groundwater_stress_pct > 90:
        return 65.0  # over-exploited / critical
    if groundwater_stress_pct >= 70:
        return 40.0  # semi-critical
    return 30.0  # safe


def score_pm_kisan(row: dict, rng: random.Random) -> float:
    base = 85.0 if row.get("claim_type") == "IFR" else 22.0
    return round(_clip(rng.gauss(base, 5)), 2)


def score_mgnrega(row: dict, rng: random.Random) -> float:
    gw_score = _gw_mandate_pct(row.get("groundwater_stress_pct")) / 65.0 * 100.0
    is_sa = bool(row.get("is_scheduled_area"))
    claim = row.get("claim_type")
    if claim == "IFR" and is_sa:
        bonus = 25.0
    elif claim in ("CR", "CFR") and is_sa:
        bonus = 15.0
    else:
        bonus = 5.0
    base = 0.55 * gw_score + 0.45 * (40.0 + bonus)
    return round(_clip(rng.gauss(base, 5)), 2)


def score_jjm(row: dict, rng: random.Random) -> float:
    gw_score = _gw_mandate_pct(row.get("groundwater_stress_pct")) / 65.0 * 100.0
    is_sa = bool(row.get("is_scheduled_area"))
    base = 50.0 + 0.3 * (gw_score - 50.0) + (15.0 if is_sa else 0.0)
    return round(_clip(rng.gauss(base, 6)), 2)


def score_pmfby(row: dict, rng: random.Random) -> float:
    rainfall = row.get("rainfall_mm_avg")
    rain_dev = (rainfall - 1150.0) if rainfall is not None else 0.0
    base = 55.0 + 0.02 * rain_dev
    return round(_clip(rng.gauss(base, 6)), 2)


def score_pmksy(row: dict, rng: random.Random) -> float:
    gw_pct = row.get("groundwater_stress_pct")
    if gw_pct is None:
        gw_component = 40.0
    elif gw_pct > 90:
        gw_component = 100.0
    elif gw_pct >= 70:
        gw_component = 40.0
    else:
        gw_component = 0.0

    rainfall = row.get("rainfall_mm_avg")
    if rainfall is None:
        rain_component = 50.0
    elif rainfall < 900:
        rain_component = 100.0
    elif rainfall <= 1300:
        rain_component = 65.0
    else:
        rain_component = 0.0

    scst_component = 100.0 if row.get("is_scheduled_area") else 30.0

    land = row.get("land_area_ha")
    land_component = 100.0 if (land is not None and land <= 2.0) else 75.0

    claim_component = 70.0 if row.get("claim_type") in ("CR", "CFR") else 50.0

    ph = row.get("soil_ph")
    oc = row.get("soil_organic_carbon")
    soil_favorable = (
        ph is not None and 6.5 <= ph <= 7.5
        and oc is not None and oc > 0.5
    )
    soil_component = 70.0 if soil_favorable else 40.0

    base = (
        0.15 * gw_component
        + 0.30 * rain_component
        + 0.15 * scst_component
        + 0.20 * land_component
        + 0.10 * claim_component
        + 0.10 * soil_component
    )
    return round(_clip(rng.gauss(base, 4)), 2)


def score_soil_health_card(row: dict, rng: random.Random) -> float:
    ph = row.get("soil_ph")
    if ph is None:
        ph_need = 50.0
    elif ph < 6.5:
        ph_need = 90.0
    elif ph > 7.5:
        ph_need = 80.0
    else:
        ph_need = 20.0

    oc = row.get("soil_organic_carbon")
    if oc is None:
        oc_need = 50.0
    elif oc < 0.5:
        oc_need = 90.0
    elif oc <= 0.75:
        oc_need = 50.0
    else:
        oc_need = 15.0

    base = 0.5 * ph_need + 0.5 * oc_need
    return round(_clip(rng.gauss(base, 4)), 2)


SCORERS = {
    "pm_kisan_score": score_pm_kisan,
    "mgnrega_score": score_mgnrega,
    "jjm_score": score_jjm,
    "pmfby_score": score_pmfby,
    "pmksy_score": score_pmksy,
    "soil_health_card_score": score_soil_health_card,
}


def score_row(row: dict, rng: random.Random) -> dict:
    return {name: fn(row, rng) for name, fn in SCORERS.items()}
