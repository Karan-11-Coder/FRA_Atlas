"""Claims CRUD and officer endpoints through the FastAPI app."""
import uuid

CHHINDWARA = {"state": "Madhya Pradesh", "district": "Chhindwara", "lat": 22.03435, "lon": 78.92785}


def _new_claim(client, headers, **extra):
    body = {**CHHINDWARA, "village": f"Village {uuid.uuid4().hex[:6]}", "patta_holder": "Test Holder",
            "land_area": 1.2, "status": "Pending", **extra}
    r = client.post("/api/claims", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()["claim"]


# ---------- claims ----------

def test_create_get_list_claim(client, auth):
    c = _new_claim(client, auth)
    assert c["assigned_officer_id"] is not None and c["assigned_date"]
    assert client.get(f"/api/claims/{c['id']}", headers=auth).json()["claim"]["village"] == c["village"]
    listed = client.get("/api/claims", headers=auth, params={"village": c["village"]}).json()
    assert [x["id"] for x in listed] == [c["id"]]


def test_create_requires_state_district_village(client, auth):
    r = client.post("/api/claims", headers=auth, json={"state": "Odisha", "district": "Koraput"})
    assert r.status_code == 400 and "village" in r.json()["detail"]


def test_status_is_validated(client, auth):
    assert client.post("/api/claims", headers=auth, json={**CHHINDWARA, "village": "V", "status": "Approved"}).status_code == 400
    c = _new_claim(client, auth)
    assert client.put(f"/api/claims/{c['id']}", headers=auth, json={"status": "Maybe"}).status_code == 400


def test_granting_sets_closed_date(client, auth):
    c = _new_claim(client, auth)
    r = client.put(f"/api/claims/{c['id']}", headers=auth, json={"status": "Granted"})
    assert r.status_code == 200
    assert r.json()["status"] == "Granted" and r.json()["closed_date"]


def test_delete_claim(client, auth):
    c = _new_claim(client, auth)
    assert client.delete(f"/api/claims/{c['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/claims/{c['id']}", headers=auth).status_code == 404


def test_bulk_delete_is_admin_only_and_needs_confirm(client, auth, admin_auth):
    ids = [_new_claim(client, auth)["id"] for _ in range(2)]
    q = ",".join(map(str, ids))
    assert client.delete(f"/api/claims?ids={q}&confirm=true", headers=auth).status_code == 403
    assert client.delete(f"/api/claims?ids={q}", headers=admin_auth).status_code == 400
    r = client.delete(f"/api/claims?ids={q}&confirm=true", headers=admin_auth)
    assert r.status_code == 200 and r.json()["deleted"] == 2


def test_claims_require_auth(client):
    assert client.get("/api/claims").status_code == 401
    assert client.post("/api/claims", json={**CHHINDWARA, "village": "V"}).status_code == 401


# ---------- officers ----------

def test_list_officers(client, auth):
    r = client.get("/api/officers", headers=auth)
    assert r.status_code == 200
    rows = r.json()
    assert any(o["username"] == "officer@fra-atlas.test" for o in rows)
    assert all("hashed_password" not in o for o in rows)


def test_create_officer_is_admin_only(client, auth, admin_auth):
    body = {"username": f"new-{uuid.uuid4().hex[:6]}@example.org", "password": "not-a-real-password",
            "full_name": "New Officer", "age": 35, "gender": "F", "district": "Koraput"}
    assert client.post("/api/officers", headers=auth, json=body).status_code == 403
    assert client.post("/api/officers", headers=admin_auth, json=body).status_code == 200
    assert any(o["username"] == body["username"] for o in client.get("/api/officers", headers=admin_auth).json())


def test_officer_dashboard_counts_assigned_claims(client, admin_auth):
    me = client.get("/api/me", headers=admin_auth).json()["user"]
    before = client.get(f"/api/officers/{me['id']}/dashboard", headers=admin_auth).json()["metrics"]["assigned"]
    c = _new_claim(client, admin_auth)
    client.put(f"/api/claims/{c['id']}", headers=admin_auth, json={"status": "Granted"})
    d = client.get(f"/api/officers/{me['id']}/dashboard", headers=admin_auth).json()
    assert d["metrics"]["assigned"] == before + 1
    assert d["metrics"]["completed"] >= 1
    assert 0 <= d["credibility_score"] <= 100
