"""
geo_features.py

Given a coordinate, returns real (or best-available) facts about that plot:
- Soil (pH, organic carbon, clay %)  -> LIVE API call (ISRIC SoilGrids)
- Elevation                          -> LIVE API call (open-elevation)
- Distance to nearest water body     -> from a downloaded geometry file
                                         (NOT YET SUPPLIED -- returns None,
                                         do not fake this value)
- Groundwater stress, rainfall,
  Scheduled Area status              -> static reference tables
"""

import time
import requests
from shapely.geometry import shape, Point

from backend.services.reference_datasheets import (
    get_scheduled_area,
    get_rainfall_mm,
    get_groundwater_stress_pct,
)

SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"

WATER_GEOJSON_PATH = None
_water_geoms_cache = None


def _load_water_geometries():
    global _water_geoms_cache
    if _water_geoms_cache is not None:
        return _water_geoms_cache
    if not WATER_GEOJSON_PATH:
        _water_geoms_cache = []
        return _water_geoms_cache
    import json
    with open(WATER_GEOJSON_PATH) as f:
        data = json.load(f)
    _water_geoms_cache = [shape(feat["geometry"]) for feat in data.get("features", [])]
    return _water_geoms_cache


def fetch_soil(lat: float, lon: float, retries: int = 3, timeout: int = 20) -> dict:
    result = {"soil_ph": None, "soil_organic_carbon": None, "soil_clay_pct": None}
    props = {"phh2o": "soil_ph", "soc": "soil_organic_carbon", "clay": "soil_clay_pct"}

    for prop_code, out_key in props.items():
        for attempt in range(retries):
            try:
                r = requests.get(
                    SOILGRIDS_URL,
                    params={"lon": lon, "lat": lat, "property": prop_code,
                            "depth": "0-5cm", "value": "mean"},
                    timeout=timeout,
                )
                if r.status_code == 200:
                    data = r.json()
                    layers = data.get("properties", {}).get("layers", [])
                    if layers:
                        mean_val = layers[0]["depths"][0]["values"]["mean"]
                        if mean_val is not None:
                            d_factor = layers[0]["unit_measure"]["d_factor"]
                            result[out_key] = mean_val / d_factor
                    break
            except (requests.RequestException, KeyError, ValueError):
                time.sleep(1.5 * (attempt + 1))
                continue
    return result


def fetch_elevation(lat: float, lon: float, timeout: int = 15) -> dict:
    try:
        r = requests.get(OPEN_ELEVATION_URL, params={"locations": f"{lat},{lon}"}, timeout=timeout)
        if r.status_code == 200:
            data = r.json()
            elevation = data["results"][0]["elevation"]
            return {"elevation_m": elevation}
    except (requests.RequestException, KeyError, IndexError):
        pass
    return {"elevation_m": None}


def get_distance_to_water_km(lat: float, lon: float) -> float:
    geoms = _load_water_geometries()
    if not geoms:
        return None
    point = Point(lon, lat)
    nearest_deg = min(point.distance(g) for g in geoms)
    return round(nearest_deg * 111, 2)


def get_features(lat: float, lon: float, state: str, district: str) -> dict:
    soil = fetch_soil(lat, lon)
    elevation = fetch_elevation(lat, lon)
    water_km = get_distance_to_water_km(lat, lon)
    scheduled = get_scheduled_area(state)

    return {
        "lat": lat, "lon": lon, "state": state, "district": district,
        "soil_ph": soil["soil_ph"],
        "soil_organic_carbon": soil["soil_organic_carbon"],
        "soil_clay_pct": soil["soil_clay_pct"],
        "elevation_m": elevation["elevation_m"],
        "distance_to_water_km": water_km,
        "groundwater_stress_pct": get_groundwater_stress_pct(state, district),
        "rainfall_mm_avg": get_rainfall_mm(state, district),
        "is_scheduled_area": scheduled["is_scheduled_area"],
    }


if __name__ == "__main__":
    # Smoke test against a real coordinate (Chhindwara, MP).
    import json as _json
    result = get_features(lat=22.06, lon=79.18, state="Madhya Pradesh", district="Chhindwara")
    print(_json.dumps(result, indent=2))
