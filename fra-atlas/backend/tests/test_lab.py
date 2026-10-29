"""Model lab API: precomputed views, live predict/sweep vs the rules, rule cutoffs."""
import json

import pandas as pd
import pytest

from backend.services import ml_inference

ML_DIR = ml_inference._REPO_ROOT / "ml"
CHHINDWARA_INPUTS = {"land_area_ha": 1.5, "claim_type": "IFR", "soil_ph": 7.4, "soil_organic_carbon": 12.9,
                     "groundwater_stress_pct": 58, "rainfall_mm_avg": 1150}


@pytest.mark.parametrize("name", sorted(__import__("backend.routes.lab", fromlist=["VIEWS"]).VIEWS))
def test_every_view_is_served(client, name):
    r = client.get(f"/api/lab/views/{name}")
    assert r.status_code == 200 and r.json()


def test_unknown_view_404(client):
    assert client.get("/api/lab/views/secrets").status_code == 404


def test_export_matches_the_notebooks():
    """models.json (export) must reproduce ml/results/model_comparison.csv (notebooks 02/04)."""
    exported = pd.DataFrame(json.loads((ML_DIR / "artifacts/dashboard/models.json").read_text())["rows"])
    nb = pd.read_csv(ML_DIR / "results/model_comparison.csv")
    nb = nb[~nb.model.str.startswith("baseline")].copy()
    nb["model"] = nb.model.str.replace(r"MLP .*", "MLP", regex=True)
    merged = nb.merge(exported, on=["target", "model"], suffixes=("_nb", "_ex"))
    assert len(merged) == len(nb)
    assert (merged.cv_R2_nb - merged.cv_R2_ex).abs().max() < 0.005
    assert (merged.test_R2_nb - merged.test_R2_ex).abs().max() < 0.005


def test_predict_returns_every_model_and_the_rule(client):
    r = client.post("/api/lab/predict", json=CHHINDWARA_INPUTS).json()
    models = set(r["models"])
    for t, scores in r["scores"].items():
        assert set(scores) == models | {"rule"}
    # the chosen PM-KISAN model is the rule: claim type alone
    assert abs(r["scores"]["pm_kisan_score"]["simple linear"] - r["scores"]["pm_kisan_score"]["rule"]) < 3


def test_chosen_models_track_the_rule_on_a_sweep(client):
    body = {"inputs": CHHINDWARA_INPUTS, "feature": "soil_organic_carbon", "points": 21}
    r = client.post("/api/lab/sweep", json=body).json()
    assert len(r["grid"]) == 21
    curve = r["curves"]["soil_health_card_score"]
    gap = sum(abs(a - b) for a, b in zip(curve["decision tree"], curve["rule"])) / len(curve["rule"])
    assert gap < 4          # within the label noise SD
    cats = client.post("/api/lab/sweep", json={**body, "feature": "claim_type"}).json()
    assert cats["grid"] == ["IFR", "CFR", "CR"]


def test_out_of_range_inputs_are_flagged(client):
    r = client.post("/api/lab/predict", json={**CHHINDWARA_INPUTS, "rainfall_mm_avg": 3000}).json()
    assert any("outside the training range" in n for n in r["notes"])


def test_bad_inputs_are_422(client):
    assert client.post("/api/lab/predict", json={**CHHINDWARA_INPUTS, "claim_type": "X"}).status_code == 422
    assert client.post("/api/lab/sweep", json={"inputs": CHHINDWARA_INPUTS, "feature": "lat"}).status_code == 422


def test_resolve_and_district_defaults(client):
    r = client.post("/api/lab/resolve", json={"lat": 22.03435, "lon": 78.92785}).json()
    assert r["district"] == "Chhindwara" and r["values"]["rainfall_mm_avg"] == 1150
    assert client.post("/api/lab/resolve", json={"lat": 28.61, "lon": 77.21}).status_code == 422
    d = client.get("/api/lab/district-defaults/Koraput").json()
    assert d["state"] == "Odisha" and d["values"]["groundwater_stress_pct"] == 30


def test_rule_cutoffs(client):
    default = client.post("/api/lab/rules/cutoff", json={}).json()
    assert default["schemes"]["soil_health_card_score"]["changed_share"] == 0
    moved = client.post("/api/lab/rules/cutoff", json={"oc_low_pct": 1.75}).json()
    assert 0.10 < moved["schemes"]["soil_health_card_score"]["changed_share"] < 0.20     # EDA F6: 14.9%
    assert client.post("/api/lab/rules/cutoff", json={"oc_low_pct": 3, "oc_high_pct": 2}).status_code == 422
    from backend.services import scheme_rules
    assert scheme_rules.OC_LOW_PCT == 1.5        # constants restored


def test_rules_endpoint(client):
    r = client.get("/api/lab/rules").json()
    assert set(r["schemes"]) == set(ml_inference.SCHEME_LABELS) and r["constants"]["PH_LOW"] == 6.5
