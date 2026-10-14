from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.creators.models import Creator
from tests.conftest import auth

OTP = settings.creator_dev_otp


async def _creator_login(client, email: str) -> dict[str, str]:
    r = await client.post("/auth/creator/request-otp", json={"email": email})
    assert r.status_code == 202, r.text
    r = await client.post("/auth/creator/verify", json={"email": email, "code": OTP})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_creator_signup_creates_pending_account(client):
    headers = await _creator_login(client, "maya@creators.example.com")

    me = await client.get("/auth/me", headers=headers)
    assert me.status_code == 200 and me.json()["role"] == "creator"

    mine = await client.get("/creators/me", headers=headers)
    assert mine.status_code == 200, mine.text
    body = mine.json()
    assert body["status"] == "pending"
    assert body["email"] == "maya@creators.example.com"
    assert body["handle"] is None
    assert body["referral_code"]


async def test_wrong_code_is_rejected(client):
    await client.post("/auth/creator/request-otp", json={"email": "x@creators.example.com"})
    r = await client.post("/auth/creator/verify", json={"email": "x@creators.example.com", "code": "9999"})
    assert r.status_code == 400
    async with SessionLocal() as session:
        assert await session.scalar(select(Creator)) is None


async def test_second_login_reuses_the_account(client):
    await _creator_login(client, "repeat@creators.example.com")
    await _creator_login(client, "repeat@creators.example.com")
    async with SessionLocal() as session:
        creators = list(await session.scalars(select(Creator)))
    assert len(creators) == 1


async def test_traveler_email_cannot_sign_in_as_creator(client, traveler):
    r = await client.post("/auth/creator/request-otp", json={"email": traveler.email})
    assert r.status_code == 202
    r = await client.post("/auth/creator/verify", json={"email": traveler.email, "code": OTP})
    assert r.status_code == 409


async def test_staff_approve_a_pending_creator(client, admin):
    headers = await _creator_login(client, "pending@creators.example.com")

    pending = await client.get("/creators", params={"status": "pending"}, headers=auth(admin))
    assert pending.status_code == 200
    rows = pending.json()
    assert len(rows) == 1 and rows[0]["email"] == "pending@creators.example.com"

    approved = await client.patch(
        f"/creators/{rows[0]['id']}",
        json={"status": "active", "handle": "mayatravels"},
        headers=auth(admin),
    )
    assert approved.status_code == 200 and approved.json()["status"] == "active"

    mine = await client.get("/creators/me", headers=headers)
    assert mine.json()["status"] == "active"
    assert mine.json()["handle"] == "mayatravels"


async def test_creator_cannot_use_staff_endpoints(client):
    headers = await _creator_login(client, "nosy@creators.example.com")
    assert (await client.get("/creators", headers=headers)).status_code == 403


async def test_traveler_has_no_creator_record(client, traveler):
    assert (await client.get("/creators/me", headers=auth(traveler))).status_code == 404
