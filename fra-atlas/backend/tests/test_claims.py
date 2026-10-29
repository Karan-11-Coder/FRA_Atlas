"""Claims CRUD, validation, import and export (no auth in the dashboard)."""
import csv
import io
import uuid

CHHINDWARA = {"state": "Madhya Pradesh", "district": "Chhindwara", "lat": 22.03435, "lon": 78.92785}


def _new_claim(client, **extra):
    body = {**CHHINDWARA, "village": f"Village {uuid.uuid4().hex[:6]}", "patta_holder": "Test Holder",
            "land_area": 1.2, "claim_type": "IFR", **extra}
    r = client.post("/api/claims", json=body)
    assert r.status_code == 200, r.text
    return r.json()["claim"]


def test_create_get_list(client):
    c = _new_claim(client)
    assert c["claim_type"] == "IFR" and c["status"] == "Pending" and c["last_status_update"]
    assert client.get(f"/api/claims/{c['id']}").json()["claim"]["village"] == c["village"]
    assert [x["id"] for x in client.get("/api/claims", params={"village": c["village"]}).json()] == [c["id"]]


def test_create_requires_state_district_village(client):
    r = client.post("/api/claims", json={"state": "Odisha", "district": "Koraput"})
    assert r.status_code == 400 and "village" in r.json()["detail"]


def test_status_and_claim_type_are_validated(client):
    assert client.post("/api/claims", json={**CHHINDWARA, "village": "V", "status": "Approved"}).status_code == 400
    assert client.post("/api/claims", json={**CHHINDWARA, "village": "V", "claim_type": "XYZ"}).status_code == 400
    c = _new_claim(client)
    assert client.put(f"/api/claims/{c['id']}", json={"status": "Maybe"}).status_code == 400
    assert client.put(f"/api/claims/{c['id']}", json={"claim_type": "cfr"}).json()["claim_type"] == "CFR"


def test_closing_and_reopening_tracks_closed_date(client):
    c = _new_claim(client)
    granted = client.put(f"/api/claims/{c['id']}", json={"status": "Granted"}).json()
    assert granted["status"] == "Granted" and granted["closed_date"]
    reopened = client.put(f"/api/claims/{c['id']}", json={"status": "Pending"}).json()
    assert reopened["closed_date"] is None


def test_delete_and_bulk_delete(client):
    c = _new_claim(client)
    assert client.delete(f"/api/claims/{c['id']}").status_code == 204
    assert client.get(f"/api/claims/{c['id']}").status_code == 404
    ids = [_new_claim(client)["id"] for _ in range(2)]
    q = ",".join(map(str, ids))
    assert client.delete(f"/api/claims?ids={q}").status_code == 400          # needs confirm
    assert client.delete(f"/api/claims?ids={q}&confirm=true").json()["deleted"] == 2


def test_import_json_and_csv_export_neutralises_formulas(client):
    r = client.post("/api/claims/import-json", json={"rows": [
        {**CHHINDWARA, "village": "Imported A", "patta_holder": "=HYPERLINK(\"x\")", "land_area": "2.5", "claim_type": "CR"},
        {**CHHINDWARA, "village": "Imported B", "claim_type": "bogus"},
    ]})
    body = r.json()
    assert body["count"] == 1 and len(body["errors"]) == 1
    export = client.get("/api/export/claims.csv").text
    rows = list(csv.DictReader(io.StringIO(export)))
    row = next(x for x in rows if x["village"] == "Imported A")
    assert row["patta_holder"].startswith("'=") and row["claim_type"] == "CR"


def test_parse_and_import_csv_sheet(client):
    sheet = "State,District,Village,Patta Holder,Area,Claim Type,Lat,Lon\nOdisha,Koraput,Sheet Village,Holder X,1.1,IFR,18.8,82.7\n"
    files = {"file": ("claims.csv", sheet.encode(), "text/csv")}
    parsed = client.post("/api/claims/parse-excel", files=files).json()
    assert parsed["rows"][0]["village"] == "Sheet Village" and parsed["rows"][0]["claim_type"] == "IFR"
    imported = client.post("/api/claims/import-excel", files={"file": ("claims.csv", sheet.encode(), "text/csv")}).json()
    assert imported["count"] == 1 and imported["claims"][0]["land_area"] == 1.1
