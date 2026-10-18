import jwt as pyjwt

from app.modules.auth import google


class _FakeResp:
    def __init__(self, data, status_code=200):
        self._data = data
        self.status_code = status_code

    def json(self):
        return self._data


class _FakeClient:
    """Stands in for httpx.AsyncClient: returns a canned Google token response."""

    def __init__(self, data, status_code=200):
        self._data = data
        self._status = status_code

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        return _FakeResp(self._data, self._status)


def _id_token(**claims) -> str:
    base = {"aud": "test-client", "iss": "accounts.google.com", "email_verified": True}
    return pyjwt.encode({**base, **claims}, "unused-signing-key", algorithm="HS256")


def _configure(monkeypatch, response_data, status_code=200):
    monkeypatch.setattr(google.settings, "google_client_id", "test-client")
    monkeypatch.setattr(google.settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(
        google.httpx, "AsyncClient", lambda *a, **k: _FakeClient(response_data, status_code)
    )


async def test_google_exchange_creates_then_matches_user(client, monkeypatch):
    _configure(monkeypatch, {"id_token": _id_token(email="g@example.com", name="G User")})

    r = await client.post(
        "/auth/google/exchange", json={"code": "abc", "redirect_uri": "http://localhost:3001/cb"}
    )
    assert r.status_code == 200, r.text
    tokens = r.json()
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.json()["email"] == "g@example.com"
    assert me.json()["role"] == "traveler"

    # A second sign-in reuses the same account rather than creating a duplicate.
    again = await client.post(
        "/auth/google/exchange", json={"code": "def", "redirect_uri": "http://localhost:3001/cb"}
    )
    assert again.status_code == 200


async def test_google_exchange_rejects_wrong_audience(client, monkeypatch):
    _configure(monkeypatch, {"id_token": _id_token(email="x@example.com", aud="someone-else")})
    r = await client.post(
        "/auth/google/exchange", json={"code": "abc", "redirect_uri": "http://localhost:3001/cb"}
    )
    assert r.status_code == 401


async def test_google_exchange_rejects_unverified_email(client, monkeypatch):
    _configure(monkeypatch, {"id_token": _id_token(email="x@example.com", email_verified=False)})
    r = await client.post(
        "/auth/google/exchange", json={"code": "abc", "redirect_uri": "http://localhost:3001/cb"}
    )
    assert r.status_code == 401


async def test_google_exchange_503_when_not_configured(client, monkeypatch):
    monkeypatch.setattr(google.settings, "google_client_id", None)
    monkeypatch.setattr(google.settings, "google_client_secret", None)
    r = await client.post(
        "/auth/google/exchange", json={"code": "abc", "redirect_uri": "http://localhost:3001/cb"}
    )
    assert r.status_code == 503
