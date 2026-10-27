"""
reference_datasheets.py

Static, real-world-grounded reference data for the four features that don't
have a reliable live per-coordinate API: groundwater stress, rainfall,
Scheduled Area status.

HONESTY NOTE: Scheduled Area status is real and verified (constitutional
fact). Rainfall and groundwater figures are approximate regional estimates
-- one data point (Chhindwara ~1145mm/yr) was verified against a real
published source; the rest are estimated from known regional climatology
patterns and not yet cross-checked against exact IMD/CGWB district reports.
Treat as reasonable starting values, replace with exact figures before
production use.
"""

SCHEDULED_AREA = {
    "Madhya Pradesh": {"is_scheduled_area": True, "schedule": "Fifth"},
    "Odisha":          {"is_scheduled_area": True, "schedule": "Fifth"},
    "Telangana":       {"is_scheduled_area": True, "schedule": "Fifth"},
    "Tripura":         {"is_scheduled_area": True, "schedule": "Sixth"},
}

RAINFALL_MM = {
    ("Madhya Pradesh", "Chhindwara"): 1150,
    ("Madhya Pradesh", "Shivpuri"):    850,
    ("Odisha", "Kandhamal"):          1450,
    ("Odisha", "Koraput"):            1400,
    ("Telangana", "Adilabad"):        1100,
    ("Telangana", "Warangal"):         950,
    ("Tripura", "West Tripura"):      2100,
}

GROUNDWATER_STRESS_PCT = {
    ("Madhya Pradesh", "Chhindwara"): 58,
    ("Madhya Pradesh", "Shivpuri"):    65,
    ("Odisha", "Kandhamal"):           32,
    ("Odisha", "Koraput"):             30,
    ("Telangana", "Adilabad"):         45,
    ("Telangana", "Warangal"):         55,
    ("Tripura", "West Tripura"):       40,
}


def get_scheduled_area(state: str) -> dict:
    return SCHEDULED_AREA.get(state, {"is_scheduled_area": False, "schedule": None})


def get_rainfall_mm(state: str, district: str) -> float:
    return RAINFALL_MM.get((state, district))


def get_groundwater_stress_pct(state: str, district: str) -> float:
    return GROUNDWATER_STRESS_PCT.get((state, district))
