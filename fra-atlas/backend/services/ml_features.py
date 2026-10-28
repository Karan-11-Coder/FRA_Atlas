"""
ml_features.py

Feature engineering shared by model training (ml/notebooks) and inference
(the DSS). The trained Pipeline in ml/artifacts/model.joblib calls
add_engineered_features() as its first step, so this module must stay
importable as backend.services.ml_features wherever that file is loaded.

Changing anything here changes what the saved model sees: retrain after
editing.
"""

import pandas as pd

from backend.services.scheme_rules import PH_LOW, PH_HIGH

# Raw inputs a caller must supply, in this order (see ml/artifacts/feature_schema.json).
RAW_FEATURES = [
    "land_area_ha",
    "claim_type",
    "soil_ph",
    "soil_organic_carbon",      # g/kg, as SoilGrids returns it
    "groundwater_stress_pct",
    "rainfall_mm_avg",
]

CLAIM_TYPES = ("IFR", "CFR", "CR")

# PMKSY rule threshold (scheme_rules.score_pmksy: land <= 2.0 ha)
SMALL_HOLDING_HA = 2.0

# Columns the model actually trains on, after engineering. claim_type is
# one-hot encoded with CR as the dropped reference level (is_ifr, is_cfr).
MODEL_FEATURES = [
    "land_area_ha",
    "small_holding",
    "is_ifr",
    "is_cfr",
    "soil_ph",
    "ph_band",
    "oc_pct",
    "groundwater_stress_pct",
    "rainfall_mm_avg",
]

# Excluded from the model (no rule reads them, and lat/lon soak up
# importance as district proxies); used only for the ablation run.
ABLATION_EXTRA = ["lat", "lon", "elevation_m", "soil_clay_pct"]


def add_engineered_features(X: pd.DataFrame) -> pd.DataFrame:
    """
    Return a copy of X with the engineered columns added:
      oc_pct        organic carbon in percent (g/kg / 10), the rule's unit
      ph_band       0 acidic (< PH_LOW) / 1 neutral / 2 alkaline (> PH_HIGH)
      small_holding 1 if land_area_ha <= SMALL_HOLDING_HA
      is_ifr/is_cfr one-hot claim_type (CR = both 0)
    Raises ValueError on a claim_type outside CLAIM_TYPES, rather than
    silently scoring it as CR.
    """
    X = pd.DataFrame(X).copy()
    claim = X["claim_type"].astype(str).str.upper()
    unknown = sorted(set(claim) - set(CLAIM_TYPES))
    if unknown:
        raise ValueError(f"Unknown claim_type {unknown}; expected one of {list(CLAIM_TYPES)}")

    X["is_ifr"] = (claim == "IFR").astype(int)
    X["is_cfr"] = (claim == "CFR").astype(int)
    X["oc_pct"] = X["soil_organic_carbon"].astype(float) / 10.0
    ph = X["soil_ph"].astype(float)
    X["ph_band"] = 1
    X.loc[ph < PH_LOW, "ph_band"] = 0
    X.loc[ph > PH_HIGH, "ph_band"] = 2
    X["small_holding"] = (X["land_area_ha"].astype(float) <= SMALL_HOLDING_HA).astype(int)
    return X
