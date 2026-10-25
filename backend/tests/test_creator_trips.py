"""Creator builds an itinerary from their own reel, edits it, publishes an affiliate link."""

import pytest

from app.core.config import settings
from app.modules.creators import service as creators
from app.modules.reels import service as reels
from app.modules.reels.models import CreatorContent
from tests.conftest import auth

OTP = settings.creator_dev_otp
REEL = "https://www.instagram.com/reel/DTripDemo01/"


async def _approved_creator(client, admin, email: str) -> dict[str, str]:
    await client.post("/auth/creator/request-otp", json={"email": email})
    r = await client.post("/auth/creator/verify", json={"email": email, "code": OTP})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    mine = (await client.get("/creators/me", headers=headers)).json()
    await client.patch(f"/creators/{mine['id']}", json={"status": "active"}, headers=auth(admin))
    return headers


@pytest.fixture(autouse=True)
def plain_itineraries(monkeypatch):
    """These tests are about editing and publishing, with a video that names two places."""
    monkeypatch.setattr(settings, "complete_itineraries", False)


@pytest.fixture
def fake_reel(monkeypatch):
    """Skip the media pipeline (covered by test_reels): produce a canned CreatorContent."""

    async def produce_content(session, ai, shortcode, on_step=None):
        existing = await reels.cached(session, shortcode)
        if existing:
            return existing
        owner = await creators.upsert(session, "goadiaries", "Goa Diaries")
        content = CreatorContent(
            creator_id=owner.id,
            shortcode=shortcode,
            url=reels.canonical_url(shortcode),
            caption="3 days in Goa",
            destination_name="Goa",
            extracted={"summary": "A slow Goa trip.", "days_hint": 3, "tips": ["Go early."]},
            places=[
                {"name": "Fort Aguada", "kind": "sight", "evidence": "sunset at fort aguada",
                 "source": "voice", "t": 4, "verified": True, "location_id": None,
                 "location_name": "Fort Aguada"},
                {"name": "Thalassa", "kind": "food", "evidence": "dinner at thalassa",
                 "source": "voice", "t": 12, "verified": False, "location_id": None,
                 "location_name": None},
            ],
        )  # fmt: skip
        session.add(content)
        await session.flush()
        return content

    monkeypatch.setattr(reels, "produce_content", produce_content)
    monkeypatch.setattr(settings, "reels_inline", True)


async def _make_trip(client, headers) -> dict:
    r = await client.post("/creator/trips/import", json={"url": REEL}, headers=headers)
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["status"] == "done", job["error"]
    assert job["creator_trip_id"]
    trips = (await client.get("/creator/trips", headers=headers)).json()
    assert len(trips) == 1
    return trips[0]


async def test_creator_builds_a_trip_from_their_reel(client, admin, fake_reel):
    headers = await _approved_creator(client, admin, "maya@creators.example.com")
    trip = await _make_trip(client, headers)
    assert trip["destination_name"] == "Goa"
    assert trip["status"] == "draft"
    assert trip["share_code"] is None
    names = [i["name"] for i in trip["items"]]
    assert names == ["Fort Aguada", "Thalassa"]
    assert trip["items"][0]["verified"] is True


async def test_creator_edits_and_publishes_an_affiliate_link(client, admin, fake_reel):
    headers = await _approved_creator(client, admin, "edit@creators.example.com")
    trip = await _make_trip(client, headers)
    tid = trip["id"]

    # Rename, add a hotel, reorder (Thalassa first), drop nothing.
    items = list(reversed(trip["items"]))
    items.append(
        {"id": "", "kind": "stay", "name": "Taj Holiday Village", "note": "Ground floor", "day": 1}
    )
    r = await client.patch(
        f"/creator/trips/{tid}",
        json={"title": "Maya's slow Goa", "items": items},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["title"] == "Maya's slow Goa"
    assert [i["name"] for i in updated["items"]] == [
        "Thalassa",
        "Fort Aguada",
        "Taj Holiday Village",
    ]
    assert updated["items"][-1]["id"]  # a fresh id was assigned

    published = (
        await client.patch(f"/creator/trips/{tid}", json={"publish": True}, headers=headers)
    ).json()
    assert published["status"] == "published"
    code = published["share_code"]
    assert code

    # The public affiliate link resolves and names the creator.
    pub = await client.get(f"/trips/{code}")
    assert pub.status_code == 200, pub.text
    body = pub.json()
    assert body["title"] == "Maya's slow Goa"
    assert body["creator"]["referral_code"]
    assert [i["name"] for i in body["items"]][0] == "Thalassa"


async def test_cannot_publish_an_empty_trip(client, admin, fake_reel):
    headers = await _approved_creator(client, admin, "empty@creators.example.com")
    trip = await _make_trip(client, headers)
    await client.patch(f"/creator/trips/{trip['id']}", json={"items": []}, headers=headers)
    r = await client.patch(f"/creator/trips/{trip['id']}", json={"publish": True}, headers=headers)
    assert r.status_code == 400


async def test_unapproved_creator_cannot_import(client, fake_reel):
    await client.post("/auth/creator/request-otp", json={"email": "new@creators.example.com"})
    r = await client.post(
        "/auth/creator/verify", json={"email": "new@creators.example.com", "code": OTP}
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (
        await client.post("/creator/trips/import", json={"url": REEL}, headers=headers)
    ).status_code == 403


async def test_a_trip_is_private_to_its_creator(client, admin, fake_reel):
    mine = await _approved_creator(client, admin, "owner@creators.example.com")
    trip = await _make_trip(client, mine)
    other = await _approved_creator(client, admin, "other@creators.example.com")
    assert (await client.get(f"/creator/trips/{trip['id']}", headers=other)).status_code == 404


async def test_unpublished_trip_has_no_public_link(client, admin, fake_reel):
    headers = await _approved_creator(client, admin, "draft@creators.example.com")
    await _make_trip(client, headers)
    assert (await client.get("/trips/nope-123456")).status_code == 404


async def test_pick_a_cover_from_the_videos_frames(client, admin, fake_reel):
    from sqlalchemy import select

    from app.db.session import SessionLocal

    headers = await _approved_creator(client, admin, "cover@creators.example.com")
    trip = await _make_trip(client, headers)
    async with SessionLocal() as session:
        content = await session.scalar(select(CreatorContent))
        content.frames = [{"t": 2.0, "key": "reels/frames/a.jpg"}, {"t": 9.5, "key": "reels/frames/b.jpg"}]
        content.thumbnail_key = "reels/cover.jpg"
        await session.commit()

    options = (await client.get(f"/creator/trips/{trip['id']}/cover-options", headers=headers)).json()
    assert [(o["source"], o["key"]) for o in options] == [
        ("video", "reels/frames/a.jpg"),
        ("video", "reels/frames/b.jpg"),
        ("reel_cover", "reels/cover.jpg"),
    ]
    assert options[1]["t"] == 9.5 and options[1]["url"].endswith("reels/frames/b.jpg")

    r = await client.patch(
        f"/creator/trips/{trip['id']}", json={"cover_image_key": "reels/frames/b.jpg"}, headers=headers
    )
    assert r.status_code == 200 and r.json()["cover_image_url"].endswith("reels/frames/b.jpg")
    options = (await client.get(f"/creator/trips/{trip['id']}/cover-options", headers=headers)).json()
    assert [o["key"] for o in options if o["current"]] == ["reels/frames/b.jpg"]

    # Only the images offered for this trip: not someone else's file, not an arbitrary path.
    for bad in ("reels/frames/other.jpg", "../../etc/passwd", "creator-covers/someone-else/x.png"):
        r = await client.patch(f"/creator/trips/{trip['id']}", json={"cover_image_key": bad}, headers=headers)
        assert r.status_code == 400, bad


async def test_upload_an_image_as_the_cover(client, admin, fake_reel):
    import base64

    headers = await _approved_creator(client, admin, "upload@creators.example.com")
    trip = await _make_trip(client, headers)
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()

    r = await client.post(
        f"/creator/trips/{trip['id']}/cover",
        json={"filename": "my cover.PNG", "data_base64": png},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert f"creator-covers/{trip['id']}/" in r.json()["cover_image_url"]
    options = (await client.get(f"/creator/trips/{trip['id']}/cover-options", headers=headers)).json()
    assert any(o["source"] == "upload" and o["current"] for o in options)

    for body in (
        {"filename": "notes.pdf", "data_base64": png},
        {"filename": "a.png", "data_base64": "not base64!!"},
        {"filename": "a.png", "data_base64": ""},
    ):
        r = await client.post(f"/creator/trips/{trip['id']}/cover", json=body, headers=headers)
        assert r.status_code == 400, body

    other = await _approved_creator(client, admin, "other@creators.example.com")
    r = await client.post(
        f"/creator/trips/{trip['id']}/cover", json={"filename": "a.png", "data_base64": png}, headers=other
    )
    assert r.status_code == 404


def test_frames_are_spread_over_the_whole_video():
    from pathlib import Path

    from app.modules.reels import media

    frames = [media.Frame(t=float(i), path=Path(f"f{i}.jpg")) for i in range(40)]
    picked = media.spread(frames, 6)
    assert len(picked) == 6 and picked[0].t == 0 and picked[-1].t == 39
    assert [f.t for f in picked] == sorted(f.t for f in picked)
    assert media.spread(frames[:4], 6) == frames[:4]
    assert media.spread(frames, 0) == [] and media.spread([], 5) == []
