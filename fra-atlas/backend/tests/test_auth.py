"""Officer JWT login, tribal OTP login (lockout + cooldown), and keeping the two token kinds apart."""
from datetime import timedelta

from jose import jwt

from backend.routes import auth_tribal
from backend.routes.auth import ALGORITHM, create_access_token

from .conftest import TEST_PASSWORD, _make_officer


# ---------- officers ----------

def test_officer_login_and_me(client):
    _make_officer("login@fra-atlas.test", "case_officer")
    r = client.post("/api/login", json={"username": "login@fra-atlas.test", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_type"] == "bearer" and body["user"]["role"] == "case_officer"
    me = client.get("/api/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["user"]["username"] == "login@fra-atlas.test"


def test_wrong_password_and_unknown_user_look_identical(client):
    _make_officer("login@fra-atlas.test", "case_officer")
    wrong = client.post("/api/login", json={"username": "login@fra-atlas.test", "password": "not-the-password"})
    unknown = client.post("/api/login", json={"username": "nobody@fra-atlas.test", "password": "x"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()          # no username enumeration


def test_missing_expired_and_forged_tokens_are_rejected(client):
    _make_officer("login@fra-atlas.test", "case_officer")
    assert client.get("/api/claims").status_code == 401
    expired = create_access_token({"sub": "login@fra-atlas.test", "role": "case_officer", "officer_id": 1},
                                  expires_delta=timedelta(minutes=-1))
    assert client.get("/api/claims", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    forged = jwt.encode({"sub": "login@fra-atlas.test", "role": "admin", "officer_id": 1}, "wrong-secret", algorithm=ALGORITHM)
    assert client.get("/api/claims", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


# ---------- tribal OTP ----------

def _send(client, number):
    return client.post("/auth/tribal/send-otp", json={"method": "mobile", "value": number})


def _verify(client, number, otp):
    return client.post("/auth/tribal/verify-otp", json={"method": "mobile", "value": number, "otp": otp})


def test_otp_happy_path_issues_tribal_token(client):
    assert _send(client, "9000000001").status_code == 200
    otp = auth_tribal.otp_store["9000000001"]["otp"]
    r = _verify(client, "9000000001", otp)
    assert r.status_code == 200
    from backend.routes.auth import JWT_SECRET
    claims = jwt.decode(r.json()["token"], JWT_SECRET, algorithms=[ALGORITHM])
    assert claims["role"] == "tribal" and claims["sub"] == "9000000001"
    assert "9000000001" not in auth_tribal.otp_store      # single use


def test_otp_rejects_bad_formats(client):
    assert client.post("/auth/tribal/send-otp", json={"method": "mobile", "value": "12345"}).status_code == 400
    assert client.post("/auth/tribal/send-otp", json={"method": "aadhaar", "value": "1234"}).status_code == 400
    assert client.post("/auth/tribal/send-otp", json={"method": "email", "value": "a@b.c"}).status_code == 400


def test_otp_resend_cooldown(client):
    assert _send(client, "9000000002").status_code == 200
    r = _send(client, "9000000002")
    assert r.status_code == 429 and "wait" in r.json()["detail"].lower()


def test_otp_lockout_after_max_attempts(client):
    assert _send(client, "9000000003").status_code == 200
    real = auth_tribal.otp_store["9000000003"]["otp"]
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(auth_tribal.MAX_OTP_ATTEMPTS):
        assert _verify(client, "9000000003", wrong).status_code == 400
    r = _verify(client, "9000000003", real)               # even the right code is refused now
    assert r.status_code == 429
    assert "9000000003" not in auth_tribal.otp_store


# ---------- token separation ----------

def _tribal_header(number="9000000009"):
    token = create_access_token({"sub": number, "role": "tribal", "method": "mobile"})
    return {"Authorization": f"Bearer {token}"}


def test_tribal_token_cannot_use_officer_endpoints(client):
    assert client.get("/api/claims", headers=_tribal_header()).status_code == 401
    assert client.get("/api/officers", headers=_tribal_header()).status_code == 401


def test_tribal_endpoint_accepts_tribal_and_rejects_officer_tokens(client, auth):
    r = client.get("/api/my-claims", headers=_tribal_header())
    assert r.status_code == 200 and r.json()["linked"] is False
    assert client.get("/api/my-claims", headers=auth).status_code == 403
