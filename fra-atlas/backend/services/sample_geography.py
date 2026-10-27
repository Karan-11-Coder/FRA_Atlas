"""
sample_geography.py

Samples synthetic training-plot coordinates using REAL district boundary
polygons and REAL village locations as anchors.

DISTRICTS_DIR and VILLAGES_PATH verified against this repo's actual GeoJSON
locations (UI_FRA/public/geojson/districts/ and
UI_FRA/public/geojson/village_records.json) -- both correct as given, no
changes needed. Confirmed: each district file is a single-feature
FeatureCollection with a Polygon geometry, and village_records.json is a
flat array of {state, district, coordinates: [lon, lat], ...} objects,
matching what this module expects.
"""

import json
import random
from pathlib import Path
from shapely.geometry import shape, Point

DISTRICTS_DIR = Path("UI_FRA/public/geojson/districts")
VILLAGES_PATH = Path("UI_FRA/public/geojson/village_records.json")

DISTRICT_FILES = {
    ("Madhya Pradesh", "Chhindwara"): "mp_chhindwara.json",
    ("Madhya Pradesh", "Shivpuri"): "mp_shivpuri.json",
    ("Odisha", "Kandhamal"): "odisha_kandhamal.json",
    ("Odisha", "Koraput"): "odisha_koraput.json",
    ("Telangana", "Adilabad"): "telangana_adilabad.json",
    ("Telangana", "Warangal"): "telangana_warangal.json",
    ("Tripura", "West Tripura"): "tripura_west.json",
}


def _load_polygon(state, district):
    fname = DISTRICT_FILES[(state, district)]
    with open(DISTRICTS_DIR / fname) as f:
        geojson = json.load(f)
    geom = geojson["features"][0]["geometry"]
    return shape(geom)


def _load_village_anchors():
    with open(VILLAGES_PATH) as f:
        villages = json.load(f)
    anchors = {}
    for v in villages:
        key = (v["state"], v["district"])
        lon, lat = v["coordinates"]
        anchors.setdefault(key, []).append((lat, lon))
    return anchors


def _random_point_in_polygon(polygon, rng, max_tries=200):
    minx, miny, maxx, maxy = polygon.bounds
    for _ in range(max_tries):
        lon = rng.uniform(minx, maxx)
        lat = rng.uniform(miny, maxy)
        p = Point(lon, lat)
        if polygon.contains(p):
            return lat, lon
    return None


def sample_district(state, district, n_points, rng, village_share=0.4):
    polygon = _load_polygon(state, district)
    anchors = _load_village_anchors().get((state, district), [])

    points = []
    n_village = int(n_points * village_share) if anchors else 0

    for _ in range(n_village):
        base_lat, base_lon = rng.choice(anchors)
        lat = base_lat + rng.uniform(-0.027, 0.027)
        lon = base_lon + rng.uniform(-0.027, 0.027)
        if polygon.contains(Point(lon, lat)):
            points.append((lat, lon))

    while len(points) < n_points:
        result = _random_point_in_polygon(polygon, rng)
        if result:
            points.append(result)
        else:
            break

    return points


def sample_all_districts(points_per_district=250, seed=42):
    rng = random.Random(seed)
    rows = []
    plot_id = 1
    for (state, district) in DISTRICT_FILES.keys():
        pts = sample_district(state, district, points_per_district, rng)
        for lat, lon in pts:
            rows.append({
                "plot_id": f"SYN-{plot_id:05d}",
                "state": state, "district": district,
                "lat": round(lat, 5), "lon": round(lon, 5),
            })
            plot_id += 1
    return rows
