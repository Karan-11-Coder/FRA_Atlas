"""
scheme_rules.py

Rule-based scoring engine that generates the 6 scheme-score training labels.

READ THIS BEFORE USING THESE SCORES
-----------------------------------
These are rule-derived labels for training a model, NOT historical scheme
allocations and NOT official eligibility determinations. Each formula
mixes two kinds of ingredient, marked below:

  [anchor]       a number taken from a real scheme document/standard (CGWB
                 groundwater categories, MGNREGA's 2025 water-works funding
                 mandate, Soil Health Card pH bands, ...).
  [constructed]  a weight, cutoff or mapping chosen by the authors because
                 no scheme-native number exists. These are defensible
                 starting points, not sourced facts.

The sourcing note this file used to cite (FRA_Atlas_Scoring_Methodology_
Note.md) has never been present in this repository; this docstring and
ml/DATA_DICTIONARY.md are the authoritative description.

CHANGELOG -- label fixes after the dataset health audit
-------------------------------------------------------
The first version had four defects, found by checking each label against
the data it was generated from:
  1. Groundwater cutoffs (70 / 90, CGWB "semi-critical" / "critical") are
     never reached: every district's groundwater_stress_pct is 30-65. The
     step function collapsed to a constant, which made jjm_score pure
     noise and left groundwater with no effect on mgnrega/pmksy. The CGWB
     anchor values are kept, but mapped continuously (_interp).
  2. soil_organic_carbon is in g/kg (7-46) while the Soil Health Card
     bands (0.5 / 0.75) are percent, so the OC terms were constants. OC is
     now converted to percent. Even then SoilGrids' 0-5 cm topsoil OC sits
     well above the official arable-soil bands (every row "high"), so the
     cutoffs are re-set to the lower/upper thirds of the real readings in
     this dataset (1.5% / 2.0%). That is an adaptation, not the official
     band.
  3. jjm_score had no learnable signal. Rebuilt from the factors JJM's own
     guidelines name for prioritisation (drought-proneness, scarce
     groundwater, SC/ST areas) -- see score_jjm.
  4. mgnrega_score was two clusters 4.5 points apart under noise of 5.
     Rebuilt from MGNREGA's real work categories (water conservation, land
     development, individual-asset works for FRA/small holdings).

HONESTY NOTE
------------
MGNREGA is a universal household entitlement (this models work-priority
relevance, not "who qualifies"), and JJM prioritises at habitation level
(this is a district-level proxy). PM-KISAN and PMFBY are close to binary
gates / district lookups dressed as scores. Only PMKSY and Soil Health Card
are genuinely multi-factor. Several features (lat, lon, elevation_m,
soil_clay_pct) feed no formula at all, and the groundwater/rainfall columns
are district-level constants, so they act as district identifiers.
"""

import random

# Gaussian noise added to each label (standard deviation, in score points).
# Exposed so check_labels.py can compute each label's theoretical R^2 ceiling.
NOISE_SD = {
    "pm_kisan_score": 5.0,
    "mgnrega_score": 5.0,
    "jjm_score": 6.0,
    "pmfby_score": 6.0,
    "pmksy_score": 4.0,
    "soil_health_card_score": 4.0,
}

# Soil Health Card pH bands [anchor]; organic-carbon bands [constructed, see
# changelog item 2] in percent.
PH_LOW, PH_HIGH = 6.5, 7.5
OC_LOW_PCT, OC_HIGH_PCT = 1.5, 2.0


def _clip(x: float) -> float:
    return max(0.0, min(100.0, x))


def _interp(x: float, xs: list, ys: list) -> float:
    """Piecewise-linear interpolation through (xs, ys), clamped at both ends."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            frac = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + frac * (ys[i] - ys[i - 1])
    return ys[-1]


def _gw_water_works_share(groundwater_stress_pct) -> float:
    """
    MGNREGA's 23-Sep-2025 water-works funding mandate [anchor]: 30% safe,
    40% semi-critical (70-90), 65% critical/over-exploited (>90). Mapped
    continuously through those anchors so districts inside the 'safe' band
    still differ. Missing value -> the semi-critical share.
    """
    if groundwater_stress_pct is None:
        return 40.0
    return _interp(groundwater_stress_pct, [0, 70, 90, 100], [30.0, 40.0, 65.0, 65.0])


def _oc_pct(row: dict):
    """SoilGrids organic carbon is g/kg; the scoring bands are percent."""
    oc = row.get("soil_organic_carbon")
    return None if oc is None else oc / 10.0


def _ph_need(ph) -> float:
    """Soil Health Card pH band -> need for soil correction (0-100)."""
    if ph is None:
        return 50.0
    if ph < PH_LOW:
        return 90.0  # acidic
    if ph > PH_HIGH:
        return 80.0  # alkaline
    return 20.0


def _oc_need(oc_pct) -> float:
    """Organic-carbon band -> need for soil correction (0-100). [constructed bands]"""
    if oc_pct is None:
        return 50.0
    if oc_pct < OC_LOW_PCT:
        return 90.0
    if oc_pct <= OC_HIGH_PCT:
        return 50.0
    return 15.0


def score_pm_kisan(row: dict, rng: random.Random) -> float:
    base = 85.0 if row.get("claim_type") == "IFR" else 22.0
    return round(_clip(rng.gauss(base, NOISE_SD["pm_kisan_score"])), 2)


def score_mgnrega(row: dict, rng: random.Random) -> float:
    """
    Work-priority relevance, from MGNREGA's own work categories. Weights are
    [constructed]; the anchors are inside the sub-scores.
      30% water need        -- groundwater-based water-works share [anchor]
      30% land-degradation  -- same pH/OC soil-correction need as the Soil
                               Health Card (soil & land-development works)
      15% holding size      -- individual-asset works favour small holdings
      25% eligibility       -- FRA titles on individual land (IFR) and
                               Scheduled Areas are explicitly covered
    """
    water = _gw_water_works_share(row.get("groundwater_stress_pct")) / 65.0 * 100.0
    degradation = 0.5 * _ph_need(row.get("soil_ph")) + 0.5 * _oc_need(_oc_pct(row))

    land = row.get("land_area_ha")
    holding = 70.0 if land is None else max(40.0, min(100.0, 100.0 - (land - 0.2) / 3.8 * 60.0))

    is_sa = bool(row.get("is_scheduled_area"))
    claim = row.get("claim_type")
    if is_sa:
        eligibility = 100.0 if claim == "IFR" else 70.0
    else:
        eligibility = 50.0 if claim == "IFR" else 30.0

    base = 0.30 * water + 0.30 * degradation + 0.15 * holding + 0.25 * eligibility
    return round(_clip(rng.gauss(base, NOISE_SD["mgnrega_score"])), 2)


def score_jjm(row: dict, rng: random.Random) -> float:
    """
    District-level drinking-water priority proxy. JJM's guidelines prioritise
    drought-prone areas, water-scarce sources and SC/ST-dominated villages;
    habitation-level data (water quality, distance to source) is not in this
    dataset, so this is deliberately coarse. Weights are [constructed].
      40% drought-proneness -- low average rainfall (700 mm -> 100, 2200 mm -> 0)
      40% groundwater stress -- stage-of-extraction % used directly
      20% SC/ST priority    -- Scheduled Area (constant in the current data)
    """
    rain = row.get("rainfall_mm_avg")
    drought = 50.0 if rain is None else 100.0 * (1.0 - max(0.0, min(1.0, (rain - 700.0) / 1500.0)))

    gw = row.get("groundwater_stress_pct")
    gw_scarcity = 40.0 if gw is None else max(0.0, min(100.0, gw))

    st_priority = 100.0 if row.get("is_scheduled_area") else 40.0

    base = 0.40 * drought + 0.40 * gw_scarcity + 0.20 * st_priority
    return round(_clip(rng.gauss(base, NOISE_SD["jjm_score"])), 2)


def score_pmfby(row: dict, rng: random.Random) -> float:
    rainfall = row.get("rainfall_mm_avg")
    rain_dev = (rainfall - 1150.0) if rainfall is not None else 0.0
    base = 55.0 + 0.02 * rain_dev
    return round(_clip(rng.gauss(base, NOISE_SD["pmfby_score"])), 2)


def score_pmksy(row: dict, rng: random.Random) -> float:
    gw_pct = row.get("groundwater_stress_pct")
    if gw_pct is None:
        gw_component = 40.0
    else:
        # Continuous version of the original 0 / 40 / 100 category scores.
        gw_component = _interp(gw_pct, [0, 70, 90, 100], [0.0, 40.0, 100.0, 100.0])

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
    oc_pct = _oc_pct(row)
    soil_favorable = (
        ph is not None and PH_LOW <= ph <= PH_HIGH
        and oc_pct is not None and oc_pct >= OC_LOW_PCT
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
    return round(_clip(rng.gauss(base, NOISE_SD["pmksy_score"])), 2)


def score_soil_health_card(row: dict, rng: random.Random) -> float:
    base = 0.5 * _ph_need(row.get("soil_ph")) + 0.5 * _oc_need(_oc_pct(row))
    return round(_clip(rng.gauss(base, NOISE_SD["soil_health_card_score"])), 2)


# Order matters: one Gaussian draw per scorer per row, so keeping this order
# keeps the unchanged labels (pm_kisan, pmfby) byte-identical across runs.
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
