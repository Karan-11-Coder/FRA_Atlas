"""Password reset / deactivation tool, and deactivated officers being locked out."""
import secrets

from backend.routes.auth import create_access_token
from backend.scripts import reset_officer_password as tool

from .conftest import TEST_PASSWORD, _make_officer


def _login(client, username, password):
    return client.post("/api/login", json={"username": username, "password": password})


def test_reset_changes_password(client):
    _make_officer("reset@fra-atlas.test", "case_officer")
    new_pw = secrets.token_urlsafe(16)
    assert "Password reset" in tool.run("reset@fra-atlas.test", password=new_pw)
    assert _login(client, "reset@fra-atlas.test", TEST_PASSWORD).status_code == 401
    assert _login(client, "reset@fra-atlas.test", new_pw).status_code == 200


def test_create_new_officer(client):
    pw = secrets.token_urlsafe(16)
    assert "Created admin" in tool.run("created@fra-atlas.test", create=True, role="admin", password=pw)
    r = _login(client, "created@fra-atlas.test", pw)
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin"


def test_unknown_officer_needs_create(client):
    assert "Use --create" in tool.run("ghost@fra-atlas.test", password=secrets.token_urlsafe(16))


def test_deactivated_officer_cannot_log_in_or_use_old_token(client):
    officer_id = _make_officer("leaver@fra-atlas.test", "case_officer")
    token = create_access_token({"sub": "leaver@fra-atlas.test", "role": "case_officer", "officer_id": officer_id})
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/claims", headers=h).status_code == 200
    assert "Deactivated" in tool.run("leaver@fra-atlas.test", deactivate=True)
    assert _login(client, "leaver@fra-atlas.test", TEST_PASSWORD).status_code == 401
    assert client.get("/api/claims", headers=h).status_code == 401


def test_short_passwords_are_refused(monkeypatch):
    monkeypatch.setenv("OFFICER_NEW_PASSWORD", "short")
    try:
        tool.read_new_password()
        raise AssertionError("short password accepted")
    except SystemExit as e:
        assert "at least" in str(e)
