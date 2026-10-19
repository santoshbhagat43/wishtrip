"""A creator's reel links: made before the reel is posted, the Instagram URL added afterwards,
each link keeping its own numbers."""

import json
import uuid

import pytest
from sqlalchemy import select

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.modules.creators import service
from app.modules.creators.models import Creator, CreatorStatus
from app.modules.reels import service as reels
from app.modules.reels.models import CreatorContent, ReelImport
from app.modules.users.models import User

OTP = settings.creator_dev_otp
REEL = "https://www.instagram.com/reel/Cabc123xyz/"


@pytest.fixture(autouse=True)
def plain_itineraries(monkeypatch):
    """These tests are about other things and use videos that name two places: no completion."""
    monkeypatch.setattr(settings, "complete_itineraries", False)


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
            thumbnail_key="reels/cover.jpg",
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
    # A picture from the reel comes along, for the card and the itinerary.
    assert link["cover_image_url"].endswith("/reels/cover.jpg")
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


async def _youtube_only(client, headers, video="dQw4w9WgXcQ"):
    link = await _make(client, headers)
    r = await client.patch(
        f"/creator/links/{link['id']}",
        json={"youtube_url": f"https://youtu.be/{video}?si=tracking"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_a_youtube_video_is_read_like_a_reel(client):
    headers = await _creator(client, "tuber@creators.example.com")
    link = await _youtube_only(client, headers)
    # Stored in one form, and queued to be downloaded and read.
    assert link["youtube_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert link["status"] == "building"
    async with SessionLocal() as session:
        job = await session.scalar(select(ReelImport))
    assert job.shortcode == "yt-dQw4w9WgXcQ"
    assert job.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    # A channel link is not a video.
    bad = await client.patch(
        f"/creator/links/{link['id']}",
        json={"youtube_url": "https://www.youtube.com/@somechannel"},
        headers=headers,
    )
    assert bad.status_code == 400 and "YouTube video" in bad.json()["detail"]


async def test_a_youtube_video_becomes_an_itinerary(client, fake_reel):
    headers = await _creator(client, "tubebuild@creators.example.com")
    link = await _youtube_only(client, headers)
    assert link["status"] == "ready"
    trip = (await client.get(f"/creator/trips/{link['trip_id']}", headers=headers)).json()
    assert [i["name"] for i in trip["items"]] == ["Fort Aguada", "Thalassa"]
    # The video's own channel isn't a WishTrip creator to credit.
    async with SessionLocal() as session:
        content = await session.scalar(select(CreatorContent))
    assert content.shortcode == "yt-dQw4w9WgXcQ"
    assert content.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


async def test_the_itinerary_keeps_its_source_when_the_other_channel_is_added(client, fake_reel):
    headers = await _creator(client, "both@creators.example.com")
    link = await _youtube_only(client, headers)  # built from YouTube
    trip_id = link["trip_id"]
    both = await client.patch(
        f"/creator/links/{link['id']}", json={"instagram_url": REEL}, headers=headers
    )
    # Adding Instagram afterwards doesn't throw the itinerary away and read it again.
    assert both.json()["trip_id"] == trip_id and both.json()["status"] == "ready"
    async with SessionLocal() as session:
        assert len(list(await session.scalars(select(ReelImport)))) == 1

    # Dropping the source it was built from reads the other one instead.
    left = (
        await client.patch(
            f"/creator/links/{link['id']}", json={"youtube_url": ""}, headers=headers
        )
    ).json()
    assert left["status"] == "ready" and left["trip_id"] != trip_id
    async with SessionLocal() as session:
        shortcodes = {j.shortcode for j in await session.scalars(select(ReelImport))}
    assert shortcodes == {"yt-dQw4w9WgXcQ", "Cabc123xyz"}


async def test_instagram_is_read_first_when_a_link_has_both(client):
    headers = await _creator(client, "first@creators.example.com")
    link = await _make(client, headers)
    r = await client.patch(
        f"/creator/links/{link['id']}",
        json={"instagram_url": REEL, "youtube_url": "https://youtu.be/dQw4w9WgXcQ"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    async with SessionLocal() as session:
        job = await session.scalar(select(ReelImport))
    assert job.shortcode == "Cabc123xyz"


async def test_there_is_nothing_to_build_without_a_reel_or_video(client):
    headers = await _creator(client, "nothing@creators.example.com")
    link = await _make(client, headers)
    r = await client.post(f"/creator/links/{link['id']}/build", headers=headers)
    assert r.status_code == 400 and "Instagram reel or YouTube video" in r.json()["detail"]


async def test_removing_the_reel_drops_its_itinerary(client, fake_reel):
    headers = await _creator(client, "undo@creators.example.com")
    link = await _link_with_reel(client, headers)
    assert link["status"] == "ready"
    cleared = await client.patch(
        f"/creator/links/{link['id']}", json={"instagram_url": ""}, headers=headers
    )
    assert cleared.json()["status"] == "waiting" and cleared.json()["trip_id"] is None


def test_days_are_spread_evenly_and_the_videos_order_is_kept():
    from app.modules.creators import trips

    def item(name, kind="sight", origin="reel"):
        return {"name": name, "kind": kind, "day": None, "origin": origin}

    # Six named places over 3 days: two a day, in the order the video named them; check-in first.
    spread = trips.assign_days([item(n) for n in "ABCDEF"] + [item("Villa", "stay")], 3)
    assert spread[0]["kind"] == "stay" and spread[0]["day"] == 1
    assert [(i["name"], i["day"]) for i in spread[1:]] == [
        ("A", 1), ("B", 1), ("C", 2), ("D", 2), ("E", 3), ("F", 3),
    ]  # fmt: skip

    # Added stops go where the days are thinnest, so a short video's days still balance.
    mixed = [item("A"), item("B"), item("x", origin="kb"), item("y", origin="suggested"),
             item("z", origin="suggested"), item("w", origin="kb")]  # fmt: skip
    per_day = [sum(1 for i in trips.assign_days(mixed, 3) if i["day"] == d) for d in (1, 2, 3)]
    assert per_day == [2, 2, 2]
    assert trips.assign_days([], 3) == []


async def test_a_reel_with_no_places_says_so(client, monkeypatch):
    async def empty(session, ai, shortcode, on_step=None):
        content = CreatorContent(
            shortcode=shortcode,
            url=reels.canonical_url(shortcode),
            destination_name="Bali",
            extracted={},
            places=[
                {"name": "Bali", "kind": "area", "evidence": "Bali", "source": "caption", "t": None,
                 "verified": False, "location_id": None, "location_name": None}
            ],
        )  # fmt: skip
        session.add(content)
        await session.flush()
        return content

    monkeypatch.setattr(reels, "produce_content", empty)
    monkeypatch.setattr(settings, "reels_inline", True)
    headers = await _creator(client, "noplaces@creators.example.com")
    link = await _link_with_reel(client, headers)
    assert link["status"] == "failed"
    assert "couldn't find any places" in link["error"]


async def test_an_unexpected_crash_ends_the_job_instead_of_hanging(client, monkeypatch):
    async def crash(session, ai, shortcode, on_step=None):
        raise RuntimeError("the worker fell over")

    monkeypatch.setattr(reels, "produce_content", crash)
    monkeypatch.setattr(settings, "reels_inline", True)
    headers = await _creator(client, "crash@creators.example.com")
    link = await _link_with_reel(client, headers)
    # Not stuck on "building": it failed, with something a creator can read (not the traceback).
    assert link["status"] == "failed"
    assert "fell over" not in link["error"] and "Try again" in link["error"]


async def test_a_lost_job_is_given_up_on_rather_than_spinning_forever(client):
    from datetime import UTC, datetime, timedelta

    headers = await _creator(client, "lost@creators.example.com")
    link = await _link_with_reel(client, headers)  # queued; the worker never takes it
    assert link["status"] == "building"
    async with SessionLocal() as session:
        job = await session.scalar(select(ReelImport))
        job.created_at = datetime.now(UTC) - timedelta(minutes=30)
        await session.commit()
    again = (await client.get("/creator/links", headers=headers)).json()[0]
    assert again["status"] == "failed" and "took too long" in again["error"]


async def test_changing_or_removing_the_reel_takes_the_old_itinerary_down(client, fake_reel):
    headers = await _creator(client, "swap@creators.example.com")
    link = await _link_with_reel(client, headers, auto_publish=True)
    code = link["share_code"]
    assert code and (await client.get(f"/trips/{code}")).status_code == 200

    other = await client.patch(
        f"/creator/links/{link['id']}",
        json={"instagram_url": "instagram.com/reel/Cother0001/"},
        headers=headers,
    )
    assert other.status_code == 200, other.text
    # The old reel's itinerary is no longer public (the new one is built, and published as asked).
    assert (await client.get(f"/trips/{code}")).status_code == 404
    assert other.json()["share_code"] != code

    await client.patch(f"/creator/links/{link['id']}", json={"instagram_url": ""}, headers=headers)
    assert (await client.get(f"/trips/{other.json()['share_code']}")).status_code == 404


# Uploading a video instead of a link ----------------------------------------------------------


@pytest.fixture
def fake_upload(monkeypatch):
    """Skip the media pipeline: an uploaded video is read into canned content."""

    async def produce(session, ai, shortcode, upload_key, on_step=None):
        content = CreatorContent(
            shortcode=shortcode,
            url="",
            destination_name="Goa",
            thumbnail_key="reels/cover.jpg",
            extracted={"summary": "A slow Goa trip.", "days_hint": 2},
            places=[
                {"name": "Fort Aguada", "kind": "sight", "evidence": "sunset", "source": "voice",
                 "t": None, "verified": False, "location_id": None, "location_name": None},
                {"name": "Thalassa", "kind": "food", "evidence": "dinner", "source": "voice",
                 "t": None, "verified": False, "location_id": None, "location_name": None},
            ],
        )  # fmt: skip
        session.add(content)
        await session.flush()
        return content

    monkeypatch.setattr(reels, "produce_content_from_upload", produce)
    monkeypatch.setattr(settings, "reels_inline", True)


def _video(name="trip.mp4", kind="video/mp4"):
    return {"content-type": kind, "x-reel-filename": name}


async def test_an_uploaded_video_becomes_an_itinerary(client, fake_upload):
    headers = await _creator(client, "uploader@creators.example.com")
    link = await _make(client, headers)
    r = await client.post(
        f"/creator/links/{link['id']}/upload",
        content=b"not really a video",
        headers={**headers, **_video()},
    )
    assert r.status_code == 200, r.text
    uploaded = r.json()
    # No link was needed: the video itself is the source.
    assert uploaded["instagram_url"] is None and uploaded["youtube_url"] is None
    assert uploaded["status"] == "ready"
    trip = (await client.get(f"/creator/trips/{uploaded['trip_id']}", headers=headers)).json()
    assert [i["name"] for i in trip["items"]] == ["Fort Aguada", "Thalassa"]

    # It can be published like any other.
    pub = await client.patch(
        f"/creator/links/{link['id']}", json={"published": True}, headers=headers
    )
    assert pub.json()["status"] == "published"

    # Adding a link afterwards doesn't throw the uploaded video's itinerary away.
    later = await client.patch(
        f"/creator/links/{link['id']}", json={"youtube_url": "https://youtu.be/dQw4w9WgXcQ"},
        headers=headers,
    )  # fmt: skip
    assert later.json()["trip_id"] == uploaded["trip_id"] and later.json()["status"] == "published"


async def test_uploading_again_replaces_the_itinerary_and_takes_the_old_one_down(
    client, fake_upload
):
    headers = await _creator(client, "again@creators.example.com")
    link = await _make(client, headers)
    first = await client.post(
        f"/creator/links/{link['id']}/upload", content=b"one", headers={**headers, **_video()}
    )
    await client.patch(f"/creator/links/{link['id']}", json={"published": True}, headers=headers)
    code = (await client.get("/creator/links", headers=headers)).json()[0]["share_code"]
    assert (await client.get(f"/trips/{code}")).status_code == 200

    second = await client.post(
        f"/creator/links/{link['id']}/upload", content=b"two", headers={**headers, **_video()}
    )
    assert second.json()["trip_id"] != first.json()["trip_id"]
    assert (await client.get(f"/trips/{code}")).status_code == 404


async def test_an_upload_must_be_a_video_that_fits(client, fake_upload, monkeypatch):
    headers = await _creator(client, "picky@creators.example.com")
    link = await _make(client, headers)
    url = f"/creator/links/{link['id']}/upload"

    not_video = await client.post(
        url, content=b"x", headers={**headers, **_video(kind="image/png")}
    )
    assert not_video.status_code == 400 and "video" in not_video.json()["detail"]
    empty = await client.post(url, content=b"", headers={**headers, **_video()})
    assert empty.status_code == 400 and "empty" in empty.json()["detail"]

    monkeypatch.setattr(settings, "reel_upload_max_mb", 0)
    big = await client.post(url, content=b"x", headers={**headers, **_video()})
    assert big.status_code == 400 and "over 0 MB" in big.json()["detail"]


async def test_only_the_owner_of_an_approved_account_can_upload(client, fake_upload):
    mine = await _creator(client, "owner2@creators.example.com")
    theirs = await _creator(client, "intruder2@creators.example.com")
    waiting = await _creator(client, "waiting2@creators.example.com", active=False)
    link = await _make(client, mine)
    url = f"/creator/links/{link['id']}/upload"
    assert (await client.post(url, content=b"x", headers={**theirs, **_video()})).status_code == 404
    assert (
        await client.post(url, content=b"x", headers={**waiting, **_video()})
    ).status_code == 403


async def test_building_again_needs_a_link_not_an_uploaded_video(client, fake_upload):
    headers = await _creator(client, "rebuild@creators.example.com")
    link = await _make(client, headers)
    await client.post(
        f"/creator/links/{link['id']}/upload", content=b"x", headers={**headers, **_video()}
    )
    # The file is gone once read, so there's nothing to read again: say what to do.
    r = await client.post(f"/creator/links/{link['id']}/build", headers=headers)
    assert r.status_code == 400 and "upload the video" in r.json()["detail"]


# A whole itinerary, never a thin one ---------------------------------------------------------


class Suggester:
    """Stands in for the AI that suggests places to complete an itinerary."""

    enabled = True
    provider = "openrouter"
    MODELS = {"intent": "i", "planner": "p", "transcribe": "t"}

    def __init__(self, places=None, fail=False, enabled=True, arrangement=None):
        self.places, self.fail, self.enabled = places or [], fail, enabled
        self.arrangement = arrangement
        self.asked = []

    def model_for(self, task):
        return self.MODELS[task]

    def supports(self, task):
        return task in self.MODELS

    async def chat(self, task, messages, **kwargs):
        self.asked.append(messages[0]["content"])
        if self.fail:
            raise RuntimeError("the AI is down")
        if "Arrange these stops" in messages[0]["content"]:
            return json.dumps({"days": self.arrangement} if self.arrangement is not None else {})
        return json.dumps({"places": self.places})


SUGGESTED_NAMES = [
    "Uluwatu Temple", "Tirta Empul", "Jimbaran Bay", "Sacred Monkey Forest", "Mount Batur",
    "Seminyak Beach", "Tanah Lot", "Nusa Dua", "Sanur Beach", "Lempuyang Gate",
]  # fmt: skip


def _suggestions(n, kind="sight"):
    return [{"name": SUGGESTED_NAMES[i], "kind": kind, "why": "fits"} for i in range(n)]


def _named(*names, kind="sight"):
    return [
        {"name": n, "kind": kind, "evidence": n, "source": "voice", "t": None,
         "verified": False, "location_id": None, "location_name": None}
        for n in names
    ]  # fmt: skip


@pytest.fixture
def whole_itineraries(monkeypatch):
    """Completion on, and a video whose named places the test chooses."""
    monkeypatch.setattr(settings, "complete_itineraries", True)
    monkeypatch.setattr(settings, "reels_inline", True)
    video = {"places": [], "days": None, "destination": "Bali", "destination_id": None}

    async def produce(session, ai, shortcode, on_step=None):
        content = CreatorContent(
            shortcode=shortcode,
            url=reels.canonical_url(shortcode),
            destination_name=video["destination"],
            destination_id=video["destination_id"],
            extracted={"summary": "A slow Bali trip.", "days_hint": video["days"]},
            places=video["places"],
        )
        session.add(content)
        await session.flush()
        return content

    monkeypatch.setattr(reels, "produce_content", produce)
    yield video
    app.dependency_overrides.pop(get_orchestrator, None)


async def _trip_of(client, headers, ai):
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=ai)
    link = await _link_with_reel(client, headers)
    if link["status"] != "ready":
        return link, None
    trip = (await client.get(f"/creator/trips/{link['trip_id']}", headers=headers)).json()
    return link, trip


def _by_day(trip):
    days: dict[int, list[dict]] = {}
    for i in trip["items"]:
        days.setdefault(i["day"], []).append(i)
    return days


async def test_a_three_place_video_becomes_a_three_day_itinerary(client, whole_itineraries):
    # A 12-second short names three places and says nothing about days: it was one thin day.
    whole_itineraries["places"] = _named(
        "Ubud Palace", "Campuhan Ridge Walk", "Tegalalang Rice Terrace"
    )
    ai = Suggester(
        [
            {"name": "Uluwatu Temple", "kind": "sight", "why": "famous cliff-top temple"},
            {"name": "Ubud Palace", "kind": "sight", "why": "already named"},  # a repeat: dropped
            {"name": "Warung Babi Guling Ibu Oka", "kind": "food", "why": "local classic"},
            {"name": "Tirta Empul", "kind": "sight", "why": "water temple"},
            {"name": "Jimbaran Bay", "kind": "experience", "why": "sunset dinner on the beach"},
            {"name": "Sacred Monkey Forest", "kind": "sight", "why": "an Ubud favourite"},
            {"name": "Mount Batur sunrise trek", "kind": "experience", "why": "a morning hike"},
        ]
    )
    headers = await _creator(client, "thin@creators.example.com")
    link, trip = await _trip_of(client, headers, ai)

    assert link["status"] == "ready"
    days = _by_day(trip)
    assert sorted(days) == [1, 2, 3]  # never a single day
    assert all(len(stops) == 3 for stops in days.values())  # a full day each
    origins = [i["origin"] for i in trip["items"]]
    assert origins.count("reel") == 3 and origins.count("suggested") == 6
    # What the video named comes first, labelled as the video's; the rest is labelled as suggested.
    assert {i["name"] for i in trip["items"] if i["origin"] == "reel"} == {
        "Ubud Palace", "Campuhan Ridge Walk", "Tegalalang Rice Terrace",
    }  # fmt: skip
    assert all(i["verified"] is False for i in trip["items"] if i["origin"] == "suggested")
    assert [i["name"] for i in trip["items"]].count("Ubud Palace") == 1
    # Each day mixes the video's places with the additions.
    assert all(any(i["origin"] == "reel" for i in stops) for stops in days.values())


async def test_the_videos_own_number_of_days_is_kept(client, whole_itineraries):
    whole_itineraries["places"] = _named("Ubud Palace", "Campuhan Ridge", "Tegalalang Terrace")
    whole_itineraries["days"] = 4
    ai = Suggester(_suggestions(10))
    headers = await _creator(client, "four@creators.example.com")
    _, trip = await _trip_of(client, headers, ai)
    assert sorted(_by_day(trip)) == [1, 2, 3, 4]
    assert len(trip["items"]) == 12


async def test_one_day_is_never_an_itinerary(client, whole_itineraries):
    whole_itineraries["places"] = _named("Ubud Palace", "Campuhan Ridge", "Tegalalang Terrace")
    whole_itineraries["days"] = 1  # "one day in Bali": still a whole trip of two days
    ai = Suggester(_suggestions(8, "food"))
    headers = await _creator(client, "oneday@creators.example.com")
    _, trip = await _trip_of(client, headers, ai)
    assert sorted(_by_day(trip)) == [1, 2]


async def test_checked_places_come_before_suggestions(client, london, whole_itineraries):
    whole_itineraries.update(
        places=_named("Tower Bridge"),
        days=2,
        destination="London",
        destination_id=london["city"]["id"],
    )
    ai = Suggester(_suggestions(3))
    headers = await _creator(client, "kb@creators.example.com")
    _, trip = await _trip_of(client, headers, ai)

    kb = [i for i in trip["items"] if i["origin"] == "kb"]
    assert {i["name"] for i in kb} == {"Borough Market Food Walk", "Thames Kayaking"}
    assert all(i["verified"] and i["location_id"] for i in kb)  # checked, and linked to the place
    # Tower Bridge was in the video, so the knowledge base doesn't add it again.
    assert [i["name"] for i in trip["items"]].count("Tower Bridge") == 1
    assert [i["origin"] for i in trip["items"]].count("suggested") == 3
    assert sorted(_by_day(trip)) == [1, 2]


async def test_without_the_ai_it_falls_back_to_fewer_days_never_one(client, whole_itineraries):
    whole_itineraries["places"] = _named(
        "Ubud Palace", "Campuhan Ridge", "Tegalalang Terrace", "Goa Gajah", "Saraswati Temple"
    )
    headers = await _creator(client, "noai@creators.example.com")
    link, trip = await _trip_of(client, headers, Suggester(enabled=False))
    assert link["status"] == "ready"
    assert sorted(_by_day(trip)) == [1, 2] and len(trip["items"]) == 5


async def test_too_few_places_to_make_a_whole_trip_is_said_not_shown(client, whole_itineraries):
    whole_itineraries["places"] = _named("Ubud Palace", "Campuhan Ridge", "Tegalalang Terrace")
    headers = await _creator(client, "toothin@creators.example.com")
    link, trip = await _trip_of(client, headers, Suggester(fail=True))  # the AI is down too
    assert link["status"] == "failed" and trip is None
    assert "too few places" in link["error"]
    assert link["trip_id"] is None  # no half-made itinerary to publish


async def test_a_long_video_is_topped_up_to_full_days_too(client, whole_itineraries):
    whole_itineraries["places"] = _named(
        *[f"Warung {c}{c.lower()}k" for c in "ABCDEFGHIJKLMNO"]
    )  # 15 places
    whole_itineraries["days"] = 7
    ai = Suggester(_suggestions(10))
    headers = await _creator(client, "long@creators.example.com")
    _, trip = await _trip_of(client, headers, ai)
    days = _by_day(trip)
    assert sorted(days) == [1, 2, 3, 4, 5, 6, 7]
    assert all(len(stops) == 3 for stops in days.values())  # 21 stops: the 15 named plus 6 more


def test_the_number_of_days_follows_the_video_but_is_never_below_two():
    from app.modules.reels.complete import target_days

    assert [target_days(h) for h in (None, 1, 2, 4, 7, 30)] == [3, 2, 2, 4, 7, 7]


REEL_THREE = ["Ubud Palace", "Campuhan Ridge Walk", "Tegalalang Rice Terrace"]
BY_AREA = [
    ["Ubud Palace", "Sacred Monkey Forest", "Campuhan Ridge Walk"],
    ["Tegalalang Rice Terrace", "Tirta Empul", "Mount Batur"],
    ["Uluwatu Temple", "Jimbaran Bay", "Seminyak Beach"],
]


async def test_days_are_grouped_by_where_things_are(client, whole_itineraries):
    whole_itineraries["places"] = _named(*REEL_THREE)
    ai = Suggester(_suggestions(6), arrangement=BY_AREA)
    headers = await _creator(client, "area@creators.example.com")
    _, trip = await _trip_of(client, headers, ai)
    days = _by_day(trip)
    # Exactly as the AI grouped them, in its order: Ubud together, the south together.
    assert [[i["name"] for i in days[d]] for d in (1, 2, 3)] == BY_AREA
    # Still labelled by where each came from.
    origins = {i["name"]: i["origin"] for i in trip["items"]}
    assert origins["Ubud Palace"] == "reel" and origins["Uluwatu Temple"] == "suggested"


@pytest.mark.parametrize(
    "arrangement",
    [
        [["Ubud Palace", "Invented Place", "Tirta Empul"], BY_AREA[1], BY_AREA[2]],  # made up
        [BY_AREA[0][:2], BY_AREA[1], BY_AREA[2]],  # a stop left out
        [BY_AREA[0], BY_AREA[1]],  # the wrong number of days
        [[*BY_AREA[0], *BY_AREA[1][:1]], BY_AREA[1][1:2], BY_AREA[2]],  # lopsided: 4, 1, 3
        [BY_AREA[0], BY_AREA[1], BY_AREA[2], BY_AREA[2]],  # too many days, stops twice
        "not a list",
    ],
)
async def test_a_bad_arrangement_falls_back_to_an_even_spread(
    client, whole_itineraries, arrangement
):
    whole_itineraries["places"] = _named(*REEL_THREE)
    ai = Suggester(_suggestions(6), arrangement=arrangement)
    headers = await _creator(client, "badarea@creators.example.com")
    link, trip = await _trip_of(client, headers, ai)
    assert link["status"] == "ready"
    days = _by_day(trip)
    assert sorted(days) == [1, 2, 3] and all(len(stops) == 3 for stops in days.values())
    assert len({i["name"] for i in trip["items"]}) == 9  # nothing lost, nothing invented
    assert "Invented Place" not in [i["name"] for i in trip["items"]]


def test_the_same_place_is_not_added_twice_but_neighbours_are():
    from app.modules.reels.complete import _already_there

    have = [{"name": "Ubud Palace"}, {"name": "Tegalalang Rice Terrace"}]
    assert _already_there("Palace of Ubud", have)  # the same words
    assert _already_there("Tegallalang Rice Terraces", have)  # a spelling variant
    assert _already_there("Ubud Palace", have)
    assert not _already_there("Ubud Monkey Forest", have)  # shares only the town's name
    assert not _already_there("Jatiluwih Rice Terraces", have)  # shares only a kind of place
