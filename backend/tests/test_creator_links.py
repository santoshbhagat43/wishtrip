"""A creator's reel links: made before the reel is posted, the Instagram URL added afterwards,
each link keeping its own numbers."""

import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.creators import service
from app.modules.creators.models import Creator, CreatorStatus
from app.modules.users.models import User

OTP = settings.creator_dev_otp


async def _creator(client, email: str, *, active: bool = True) -> dict[str, str]:
    """A signed-in creator, approved unless asked otherwise."""
    await client.post("/auth/creator/request-otp", json={"email": email})
    r = await client.post("/auth/creator/verify", json={"email": email, "code": OTP})
    assert r.status_code == 200, r.text
    if active:
        async with SessionLocal() as session:
            creator = await session.scalar(select(Creator).where(Creator.email == email))
            creator.status = CreatorStatus.ACTIVE
            creator.commission_per_user_paise = 5000
            await session.commit()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _make(client, headers, label="Goa beach reel", destination_id=None):
    r = await client.post(
        "/creator/links", json={"label": label, "destination_id": destination_id}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_a_link_starts_waiting_for_its_reel(client, london):
    headers = await _creator(client, "maker@creators.example.com")
    link = await _make(client, headers, "Slow mornings in London", london["city"]["id"])

    assert link["status"] == "waiting"
    assert link["instagram_url"] is None
    assert link["destination"]["name"] == "London"
    assert link["stats"] == {"visits": 0, "signups": 0, "trips_planned": 0, "earned_paise": 0}
    # Short and readable: a word from the destination, then four characters.
    word, suffix = link["code"].split("-")
    assert word == "london" and len(suffix) == 4

    listed = (await client.get("/creator/links", headers=headers)).json()
    assert [item["id"] for item in listed] == [link["id"]]


async def test_only_approved_creators_can_make_links(client):
    headers = await _creator(client, "waiting@creators.example.com", active=False)
    r = await client.post("/creator/links", json={"label": "Early"}, headers=headers)
    assert r.status_code == 403
    assert "approved" in r.json()["detail"]
    # They can still see their (empty) list.
    assert (await client.get("/creator/links", headers=headers)).json() == []


async def test_a_destination_must_be_a_published_city(client, london):
    headers = await _creator(client, "picky@creators.example.com")
    for bad in (london["uk"]["id"], str(uuid.uuid4())):  # a country; something that doesn't exist
        r = await client.post(
            "/creator/links", json={"label": "x", "destination_id": bad}, headers=headers
        )
        assert r.status_code == 400, r.text
    assert (
        await client.post("/creator/links", json={"label": ""}, headers=headers)
    ).status_code == 422


async def test_adding_the_instagram_url_makes_the_link_live(client):
    headers = await _creator(client, "poster@creators.example.com")
    link = await _make(client, headers)

    r = await client.patch(
        f"/creator/links/{link['id']}",
        json={"instagram_url": "https://www.instagram.com/reel/Cabc123xyz/?igsh=tracking"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    live = r.json()
    assert live["status"] == "live"
    # Stored in one canonical form, without the tracking noise.
    assert live["instagram_url"] == "https://www.instagram.com/reel/Cabc123xyz/"

    # Not a reel link: refused with something a creator can act on.
    bad = await client.patch(
        f"/creator/links/{link['id']}",
        json={"instagram_url": "https://example.com/x"},
        headers=headers,
    )
    assert bad.status_code == 400 and "Instagram reel" in bad.json()["detail"]

    # Blank takes it back to waiting (a wrong paste can be undone).
    cleared = await client.patch(
        f"/creator/links/{link['id']}", json={"instagram_url": ""}, headers=headers
    )
    assert cleared.json()["status"] == "waiting" and cleared.json()["instagram_url"] is None


async def test_one_reel_cannot_sit_on_two_links(client):
    headers = await _creator(client, "twice@creators.example.com")
    first, second = await _make(client, headers, "One"), await _make(client, headers, "Two")
    url = {"instagram_url": "instagram.com/reel/Cdup11111aa/"}
    assert (
        await client.patch(f"/creator/links/{first['id']}", json=url, headers=headers)
    ).status_code == 200
    r = await client.patch(f"/creator/links/{second['id']}", json=url, headers=headers)
    assert r.status_code == 409


async def test_nobody_can_touch_someone_elses_link(client):
    mine = await _creator(client, "owner@creators.example.com")
    theirs = await _creator(client, "intruder@creators.example.com")
    link = await _make(client, mine)

    r = await client.patch(
        f"/creator/links/{link['id']}", json={"label": "Hijacked"}, headers=theirs
    )
    assert r.status_code == 404
    assert (await client.get("/creator/links", headers=theirs)).json() == []


async def test_a_visit_credits_the_link_and_says_where_to_land(client, london):
    headers = await _creator(client, "visited@creators.example.com")
    link = await _make(client, headers, "London", london["city"]["id"])

    r = await client.post(f"/referrals/links/{link['code']}/visit", json={"visitor_id": "v1"})
    assert r.status_code == 200, r.text
    visit = r.json()
    assert visit["link_code"] == link["code"]
    assert visit["destination_id"] == london["city"]["id"]
    assert visit["referral_code"]

    await client.post(f"/referrals/links/{link['code']}/visit", json={"visitor_id": "v2"})
    stats = (await client.get("/creator/links", headers=headers)).json()[0]["stats"]
    assert stats["visits"] == 2

    assert (await client.post("/referrals/links/nope-0000/visit", json={})).status_code == 404


async def test_each_link_keeps_its_own_numbers(client):
    headers = await _creator(client, "compare@creators.example.com")
    works, quiet = await _make(client, headers, "Works"), await _make(client, headers, "Quiet")
    creator = (await client.get("/creators/me", headers=headers)).json()

    visit = (
        await client.post(f"/referrals/links/{works['code']}/visit", json={"visitor_id": "v1"})
    ).json()
    signup = await client.post(
        "/auth/register",
        json={
            "email": "via-works@example.com",
            "password": "password123",
            "referral_code": visit["referral_code"],
            "visitor_id": "v1",
            "link_code": visit["link_code"],
        },
    )
    assert signup.status_code == 201

    # Their first trip plan books the creator's commission against that same link.
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.email == "via-works@example.com"))
        await service.record_trip_planned(session, user)
        await session.commit()

    by_code = {
        item["code"]: item["stats"]
        for item in (await client.get("/creator/links", headers=headers)).json()
    }
    assert by_code[works["code"]] == {
        "visits": 1,
        "signups": 1,
        "trips_planned": 1,
        "earned_paise": 5000,
    }
    assert by_code[quiet["code"]] == {
        "visits": 0,
        "signups": 0,
        "trips_planned": 0,
        "earned_paise": 0,
    }
    # And it still counts towards the creator's overall totals.
    overall = (await client.get("/creators/me/overview", headers=headers)).json()["stats"]
    assert overall["credited_travellers"] == 1 and overall["earned_paise"] == 5000
    assert creator["referral_code"] == visit["referral_code"]


async def test_a_link_from_a_different_creator_is_ignored_at_sign_up(client):
    one = await _creator(client, "first@creators.example.com")
    two = await _creator(client, "second@creators.example.com")
    one_link = await _make(client, one)
    two_code = (await client.get("/creators/me", headers=two)).json()["referral_code"]

    # A forged pairing: creator two's code with creator one's link.
    r = await client.post(
        "/auth/register",
        json={
            "email": "forged@example.com",
            "password": "password123",
            "referral_code": two_code,
            "link_code": one_link["code"],
        },
    )
    assert r.status_code == 201
    assert (await client.get("/creator/links", headers=one)).json()[0]["stats"]["signups"] == 0
    # Creator two still gets the sign-up; the link just isn't credited.
    assert (await client.get("/creators/me/overview", headers=two)).json()["stats"][
        "credited_travellers"
    ] == 1


@pytest.mark.parametrize("path", ["/creator/links"])
async def test_links_need_a_creator_account(client, traveler, path):
    from tests.conftest import auth

    assert (await client.get(path)).status_code == 401
    assert (await client.get(path, headers=auth(traveler))).status_code == 404
