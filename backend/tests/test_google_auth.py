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


async def test_google_signup_credits_the_creator_whose_link_brought_them(client, monkeypatch):
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.modules.creators.models import Creator
    from app.modules.users.models import User

    async with SessionLocal() as session:
        session.add(Creator(handle="keralaslow", referral_code="keralaslow"))
        session.add(
            User(email="old@example.com", hashed_password="x", full_name="Old", role="traveler")
        )
        await session.commit()
    referral = {"referral_code": "keralaslow", "visitor_id": "v9"}

    # A brand-new account through the creator's link is credited to them.
    _configure(monkeypatch, {"id_token": _id_token(email="newbie@example.com", name="Newbie")})
    r = await client.post(
        "/auth/google/exchange",
        json={"code": "c1", "redirect_uri": "http://localhost:3001/cb", **referral},
    )
    assert r.status_code == 200, r.text

    # Someone who already had an account is signing in, not signing up: no credit.
    _configure(monkeypatch, {"id_token": _id_token(email="old@example.com", name="Old")})
    r = await client.post(
        "/auth/google/exchange",
        json={"code": "c2", "redirect_uri": "http://localhost:3001/cb", **referral},
    )
    assert r.status_code == 200, r.text

    async with SessionLocal() as session:
        creator = await session.scalar(select(Creator).where(Creator.handle == "keralaslow"))
        newbie = await session.scalar(select(User).where(User.email == "newbie@example.com"))
        old = await session.scalar(select(User).where(User.email == "old@example.com"))
    assert newbie.referred_by_creator_id == creator.id
    assert old.referred_by_creator_id is None
