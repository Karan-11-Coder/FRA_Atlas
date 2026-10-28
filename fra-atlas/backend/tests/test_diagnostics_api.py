"""POST /api/diagnostics end to end through the FastAPI app."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.db import get_db_path, ensure_officers_table_sync
from backend.main import app
from backend.routes.auth import create_access_token, hash_password
from backend.services import ml_inference

CHHINDWARA = (22.03435, 78.92785)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:      # runs startup: tables + model load
        yield c


@pytest.fixture(scope="module")
def auth(client):
    conn = sqlite3.connect(get_db_path())
    ensure_officers_table_sync(conn)
    conn.execute("INSERT OR IGNORE INTO officers (username, hashed_password, full_name, role) VALUES (?, ?, ?, ?)",
                 ("dss-test@fra-atlas.test", hash_password("not-used-for-login"), "DSS Test", "case_officer"))
    conn.commit()
    officer_id = conn.execute("SELECT id FROM officers WHERE username = ?", ("dss-test@fra-atlas.test",)).fetchone()[0]
    conn.close()
    token = create_access_token({"sub": "dss-test@fra-atlas.test", "role": "case_officer", "officer_id": officer_id})
    return {"Authorization": f"Bearer {token}"}


def test_requires_auth(client):
    assert client.post("/api/diagnostics", json={"lat": CHHINDWARA[0], "lon": CHHINDWARA[1]}).status_code == 401


def test_scores_coordinates(client, auth):
    r = client.post("/api/diagnostics", headers=auth,
                    json={"lat": CHHINDWARA[0], "lon": CHHINDWARA[1], "land_area": 1.5, "claim_type": "IFR"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["district"] == "Chhindwara"
    assert len(body["recommendations"]) == 6
    assert body["disclaimer"] == "Rule-derived suitability, not an eligibility decision."
    assert {e["input"] for e in body["estimated_inputs"]} == {"soil_ph", "soil_organic_carbon", "groundwater_stress_pct", "rainfall_mm_avg"}
    # old contract still present for existing callers
    assert {"name", "score", "reasons"} <= set(body["recommendations"][0])


def test_scores_stored_claim_by_id(client, auth):
    created = client.post("/api/claims", headers=auth, json={
        "state": "Madhya Pradesh", "district": "Chhindwara", "village": "Test Village",
        "lat": CHHINDWARA[0], "lon": CHHINDWARA[1], "land_area": 2.0, "status": "Pending"}).json()["claim"]
    r = client.post("/api/diagnostics", headers=auth, json={"claim_id": created["id"], "claim_type": "CFR"})
    assert r.status_code == 200, r.text
    assert r.json()["input"]["land_area"] == 2.0


def test_unknown_claim_is_404(client, auth):
    assert client.post("/api/diagnostics", headers=auth, json={"claim_id": 999999, "claim_type": "IFR"}).status_code == 404


def test_outside_districts_is_422(client, auth):
    r = client.post("/api/diagnostics", headers=auth, json={"lat": 28.61, "lon": 77.21, "land_area": 1, "claim_type": "IFR"})
    assert r.status_code == 422 and "outside the 7 districts" in r.json()["detail"]


def test_missing_claim_type_is_422(client, auth):
    r = client.post("/api/diagnostics", headers=auth, json={"lat": CHHINDWARA[0], "lon": CHHINDWARA[1], "land_area": 1})
    assert r.status_code == 422 and "claim_type" in r.json()["detail"]


def test_no_model_is_503_never_fake_numbers(client, auth, monkeypatch, tmp_path):
    monkeypatch.setattr(ml_inference, "MODEL_PATH", tmp_path / "missing.joblib")
    ml_inference.load(force=True)
    try:
        r = client.post("/api/diagnostics", headers=auth,
                        json={"lat": CHHINDWARA[0], "lon": CHHINDWARA[1], "land_area": 1.5, "claim_type": "IFR"})
        assert r.status_code == 503
        assert "recommendations" not in r.json()
    finally:
        monkeypatch.undo()
        ml_inference.load(force=True)
