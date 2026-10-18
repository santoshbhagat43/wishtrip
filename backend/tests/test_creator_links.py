"""A creator's reel links: made before the reel is posted, the Instagram URL added afterwards,
each link keeping its own numbers."""

import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.creators import service
from app.modules.creators.models import Creator, CreatorStatus
from app.modules.reels import service as reels
from app.modules.reels.models import CreatorContent, ReelImport
from app.modules.users.models import User

OTP = settings.creator_dev_otp
REEL = "https://www.instagram.com/reel/Cabc123xyz/"


@pytest.fixture(autouse=True)
def no_worker(monkeypatch):
    """An import queued for the worker just waits: nothing reads reels in these tests."""
    from app.workers import tasks

    monkeypatch.setattr(settings, "reels_inline", False)
    monkeypatch.setattr(tasks.process_reel_task, "delay", lambda *_: None)


@pytest.fixture
def fake_reel(monkeypatch):
    """Skip the media pipeline (covered by test_reels): read the reel into canned content."""

    async def produce_content(session, ai, shortcode, on_step=None):
        existing = await reels.cached(session, shortcode)
        if existing:
            return existing
        content = CreatorContent(
            shortcode=shortcode,
            url=reels.canonical_url(shortcode),
            destination_name="Goa",
            extracted={"summary": "A slow Goa trip.", "days_hint": 3},
            places=[
                {"name": "Fort Aguada", "kind": "sight", "evidence": "sunset", "source": "voice",
                 "t": 4, "verified": True, "location_id": None, "location_name": "Fort Aguada"},
                {"name": "Thalassa", "kind": "food", "evidence": "dinner", "source": "voice",
                 "t": 12, "verified": False, "location_id": None, "location_name": None},
            ],
        )  # fmt: skip
        session.add(content)
        await session.flush()
        return content

    monkeypatch.setattr(reels, "produce_content", produce_content)
    monkeypatch.setattr(settings, "reels_inline", True)


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


async def test_adding_the_instagram_url_starts_reading_the_reel(client):
    headers = await _creator(client, "poster@creators.example.com")
    link = await _make(client, headers)

    r = await client.patch(
        f"/creator/links/{link['id']}",
        json={"instagram_url": "https://www.instagram.com/reel/Cabc123xyz/?igsh=tracking"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    added = r.json()
    # Queued for the worker: the itinerary is being built.
    assert added["status"] == "building" and added["step"] == "queued"
    # Stored in one canonical form, without the tracking noise.
    assert added["instagram_url"] == "https://www.instagram.com/reel/Cabc123xyz/"

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


async def _link_with_reel(client, headers, **extra):
    link = await _make(client, headers)
    r = await client.patch(
        f"/creator/links/{link['id']}", json={"instagram_url": REEL, **extra}, headers=headers
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_the_reel_becomes_an_itinerary_the_creator_publishes(client, fake_reel):
    headers = await _creator(client, "builder@creators.example.com")
    link = await _link_with_reel(client, headers)

    # Read straight away: a draft itinerary, not yet visible to anyone.
    assert link["status"] == "ready" and link["step"] is None
    assert link["share_code"] is None
    trip = (await client.get(f"/creator/trips/{link['trip_id']}", headers=headers)).json()
    assert [i["name"] for i in trip["items"]] == ["Fort Aguada", "Thalassa"]
    assert trip["items"][0]["t"] == 4  # where in the reel it was seen
    assert (await client.get("/trips/anything")).status_code == 404

    # Opening the link while it's a draft still lands on the home page.
    visit = await client.post(f"/referrals/links/{link['code']}/visit", json={"visitor_id": "v"})
    assert visit.json()["trip_share_code"] is None

    published = (
        await client.patch(
            f"/creator/links/{link['id']}", json={"published": True}, headers=headers
        )
    ).json()
    assert published["status"] == "published" and published["share_code"]
    assert (await client.get(f"/trips/{published['share_code']}")).status_code == 200

    # Now the reel link takes travellers to the itinerary.
    visit = await client.post(f"/referrals/links/{link['code']}/visit", json={"visitor_id": "v"})
    assert visit.json()["trip_share_code"] == published["share_code"]

    # And the creator can take it back.
    back = (
        await client.patch(
            f"/creator/links/{link['id']}", json={"published": False}, headers=headers
        )
    ).json()
    assert back["status"] == "ready" and back["share_code"] is None
    assert (await client.get(f"/trips/{published['share_code']}")).status_code == 404


async def test_auto_publish_publishes_as_soon_as_the_itinerary_is_built(client, fake_reel):
    headers = await _creator(client, "auto@creators.example.com")
    link = await _link_with_reel(client, headers, auto_publish=True)
    assert link["auto_publish"] is True
    assert link["status"] == "published" and link["share_code"]


async def test_nothing_to_publish_before_the_itinerary_exists(client):
    headers = await _creator(client, "early@creators.example.com")
    link = await _make(client, headers)
    r = await client.patch(
        f"/creator/links/{link['id']}", json={"published": True}, headers=headers
    )
    assert r.status_code == 400 and "no itinerary" in r.json()["detail"]


async def test_a_reel_that_cannot_be_read_says_why_and_can_be_retried(client, monkeypatch):
    async def blocked(session, ai, shortcode, on_step=None):
        raise reels.ReelError("Instagram is not letting us read reels right now. Try again later.")

    monkeypatch.setattr(reels, "produce_content", blocked)
    monkeypatch.setattr(settings, "reels_inline", True)
    headers = await _creator(client, "blocked@creators.example.com")
    link = await _link_with_reel(client, headers)
    assert link["status"] == "failed"
    assert "not letting us read" in link["error"]

    # Retrying reads it again (here it still fails, but as a fresh attempt).
    again = await client.post(f"/creator/links/{link['id']}/build", headers=headers)
    assert again.status_code == 200 and again.json()["status"] == "failed"
    async with SessionLocal() as session:
        jobs = list(await session.scalars(select(ReelImport)))
    assert len(jobs) == 2


async def test_the_same_reel_link_is_not_read_twice(client, fake_reel):
    headers = await _creator(client, "once@creators.example.com")
    link = await _link_with_reel(client, headers)
    await client.patch(
        f"/creator/links/{link['id']}",
        json={"instagram_url": REEL, "auto_publish": True},
        headers=headers,
    )
    async with SessionLocal() as session:
        assert len(list(await session.scalars(select(ReelImport)))) == 1


async def test_a_youtube_video_is_stored_but_not_read_yet(client):
    headers = await _creator(client, "tuber@creators.example.com")
    link = await _make(client, headers)
    r = await client.patch(
        f"/creator/links/{link['id']}",
        json={"youtube_url": "https://youtu.be/dQw4w9WgXcQ?si=tracking"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["youtube_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert r.json()["status"] == "unread"

    bad = await client.patch(
        f"/creator/links/{link['id']}",
        json={"youtube_url": "https://www.youtube.com/@somechannel"},
        headers=headers,
    )
    assert bad.status_code == 400 and "YouTube video" in bad.json()["detail"]

    # There's no Instagram reel to read, so building says what to do.
    build = await client.post(f"/creator/links/{link['id']}/build", headers=headers)
    assert build.status_code == 400 and "Instagram" in build.json()["detail"]


async def test_removing_the_reel_drops_its_itinerary(client, fake_reel):
    headers = await _creator(client, "undo@creators.example.com")
    link = await _link_with_reel(client, headers)
    assert link["status"] == "ready"
    cleared = await client.patch(
        f"/creator/links/{link['id']}", json={"instagram_url": ""}, headers=headers
    )
    assert cleared.json()["status"] == "waiting" and cleared.json()["trip_id"] is None
