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


async def _publish_trips(client, headers, urls: list[str]) -> list[dict]:
    """Make and publish one trip per reel URL; return the creator's trips, oldest first."""
    for url in urls:
        r = await client.post("/creator/trips/import", json={"url": url}, headers=headers)
        assert r.status_code == 201 and r.json()["status"] == "done", r.text
    mine = (await client.get("/creator/trips", headers=headers)).json()
    for trip in mine:
        await client.patch(f"/creator/trips/{trip['id']}", json={"publish": True}, headers=headers)
    return list(reversed(mine))


async def test_public_creator_pages(client, admin, fake_reel):
    # An approved creator with no published trip is not on the page.
    headers = await _approved_creator(client, admin, "ananya@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()
    staff = auth(admin)
    await client.patch(
        f"/creators/{me['id']}",
        json={"handle": "ananyawanders", "display_name": "Ananya Rao"},
        headers=staff,
    )
    index = (await client.get("/explore/creators")).json()
    assert index["creators"] == 0 and index["all"] == [] and index["spotlight"] is None

    await _publish_trips(client, headers, [REEL])
    index = (await client.get("/explore/creators")).json()
    assert (index["creators"], index["trips"], index["stops"]) == (1, 1, 2)
    card = index["all"][0]
    assert card["handle"] == "ananyawanders" and card["display_name"] == "Ananya Rao"
    assert card["trips"][0]["days"] >= 1 and card["trips"][0]["stops"] == 2
    assert card["trips"][0]["share_code"] and card["trips"][0]["source_url"].startswith("https://")

    page = await client.get("/explore/creators/@AnanyaWanders")  # case and @ don't matter
    assert page.status_code == 200 and page.json()["creator"]["handle"] == "ananyawanders"
    assert (await client.get("/explore/creators/nobody")).status_code == 404


async def test_the_spotlight_is_a_trip_staff_choose_with_the_most_trips_as_the_fallback(
    client, admin, fake_reel
):
    staff = auth(admin)
    one = await _approved_creator(client, admin, "one@creators.example.com")
    two = await _approved_creator(client, admin, "two@creators.example.com")
    for headers, handle, name in ((one, "just.one", "Just One"), (two, "has.two", "Has Two")):
        me = (await client.get("/creators/me", headers=headers)).json()
        await client.patch(
            f"/creators/{me['id']}", json={"handle": handle, "display_name": name}, headers=staff
        )
    [solo] = await _publish_trips(client, one, [REEL])
    first, second = await _publish_trips(
        client, two, ["https://www.instagram.com/reel/DTwoA000001/", "https://www.instagram.com/reel/DTwoB000002/"]
    )

    # Nothing chosen: the page shows the creator who actually has the most trips.
    index = (await client.get("/explore/creators")).json()
    assert index["spotlight_chosen"] is False
    assert index["spotlight"]["handle"] == "has.two" and len(index["spotlight"]["trips"]) == 2
    state = (await client.get("/spotlight", headers=staff)).json()
    assert state["chosen_trip_id"] is None and state["automatic_creator"] == "Has Two"
    assert {t["trip_id"] for t in state["trips"]} == {solo["id"], first["id"], second["id"]}
    assert state["trips"][0]["creator_trips"] == 2  # creators with more trips come first

    # Staff pick one of the second creator's trips: it leads their card.
    r = await client.put(f"/spotlight/trips/{second['id']}", json={"on": True}, headers=staff)
    assert r.status_code == 200 and r.json()["chosen_trip_id"] == second["id"]
    index = (await client.get("/explore/creators")).json()
    assert index["spotlight_chosen"] is True
    assert index["spotlight"]["handle"] == "has.two"
    assert index["spotlight"]["trips"][0]["title"] == second["title"]

    # Another creator's trip takes it over: one at a time.
    r = await client.put(f"/spotlight/trips/{solo['id']}", json={"on": True}, headers=staff)
    assert [t["trip_id"] for t in r.json()["trips"] if t["spotlight"]] == [solo["id"]]
    assert (await client.get("/explore/creators")).json()["spotlight"]["handle"] == "just.one"

    # Taking it away goes back to the fallback.
    await client.put(f"/spotlight/trips/{solo['id']}", json={"on": False}, headers=staff)
    index = (await client.get("/explore/creators")).json()
    assert index["spotlight_chosen"] is False and index["spotlight"]["handle"] == "has.two"


async def test_only_published_trips_by_approved_creators_can_be_featured(client, admin, fake_reel):
    staff = auth(admin)
    headers = await _approved_creator(client, admin, "draft@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()
    trip = await _make_trip(client, headers)  # a draft, and no handle yet

    r = await client.put(f"/spotlight/trips/{trip['id']}", json={"on": True}, headers=staff)
    assert r.status_code == 400
    await client.patch(f"/creators/{me['id']}", json={"handle": "draft.one"}, headers=staff)
    r = await client.put(f"/spotlight/trips/{trip['id']}", json={"on": True}, headers=staff)
    assert r.status_code == 400  # still a draft
    await client.patch(f"/creator/trips/{trip['id']}", json={"publish": True}, headers=headers)
    await client.patch(f"/creators/{me['id']}", json={"status": "paused"}, headers=staff)
    r = await client.put(f"/spotlight/trips/{trip['id']}", json={"on": True}, headers=staff)
    assert r.status_code == 400  # a paused creator isn't shown
    await client.patch(f"/creators/{me['id']}", json={"status": "active"}, headers=staff)
    assert (await client.put(f"/spotlight/trips/{trip['id']}", json={"on": True}, headers=staff)).status_code == 200

    # Staff only.
    assert (await client.get("/spotlight", headers=headers)).status_code == 403
    assert (await client.put(f"/spotlight/trips/{trip['id']}", json={"on": False}, headers=headers)).status_code == 403
    assert (await client.get("/spotlight")).status_code == 401
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.put(f"/spotlight/trips/{missing}", json={"on": True}, headers=staff)).status_code == 404


async def test_creator_adds_a_profile_photo_and_a_cover_photo(client, admin, fake_reel):
    import base64

    headers = await _approved_creator(client, admin, "photos@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()
    assert me["avatar_url"] is None and me["cover_url"] is None
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()

    r = await client.post("/creators/me/avatar", json={"filename": "me.png", "data_base64": png}, headers=headers)
    assert r.status_code == 200 and f"creator-pages/{me['id']}/" in r.json()["avatar_url"]
    first = r.json()["avatar_url"]
    r = await client.post("/creators/me/cover", json={"filename": "beach.JPG", "data_base64": png}, headers=headers)
    assert r.status_code == 200 and r.json()["cover_url"].endswith(".jpg")
    # Replacing a photo gives a new one (and drops the old file).
    r = await client.post("/creators/me/avatar", json={"filename": "me2.webp", "data_base64": png}, headers=headers)
    assert r.json()["avatar_url"] != first
    overview = (await client.get("/creators/me/overview", headers=headers)).json()
    assert overview["avatar_url"] and overview["cover_url"]

    for body in (
        {"filename": "doc.pdf", "data_base64": png},
        {"filename": "a.png", "data_base64": "not base64!!"},
        {"filename": "a.png", "data_base64": ""},
    ):
        assert (await client.post("/creators/me/avatar", json=body, headers=headers)).status_code == 400

    # Their photos show on their public page, once they have a published trip.
    staff = auth(admin)
    await client.patch(f"/creators/{me['id']}", json={"handle": "photos.one", "display_name": "Photo One"}, headers=staff)
    trip = await _make_trip(client, headers)
    await client.patch(f"/creator/trips/{trip['id']}", json={"publish": True}, headers=headers)
    card = (await client.get("/explore/creators/photos.one")).json()["creator"]
    assert card["avatar_url"] and card["cover_image_url"].endswith(".jpg")  # their own cover wins

    r = await client.delete("/creators/me/cover", headers=headers)
    assert r.status_code == 200 and r.json()["cover_url"] is None
    r = await client.delete("/creators/me/avatar", headers=headers)
    assert r.json()["avatar_url"] is None
    assert (await client.post("/creators/me/avatar", json={"filename": "a.png", "data_base64": png})).status_code == 401


async def test_creator_edits_the_name_on_their_page(client, admin, fake_reel):
    headers = await _approved_creator(client, admin, "rename@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()
    await client.patch(f"/creators/{me['id']}", json={"handle": "rename.me"}, headers=auth(admin))
    trip = await _make_trip(client, headers)
    await client.patch(f"/creator/trips/{trip['id']}", json={"publish": True}, headers=headers)

    r = await client.patch("/creators/me", json={"display_name": "  Meera   Kamat "}, headers=headers)
    assert r.status_code == 200 and r.json()["display_name"] == "Meera Kamat"
    assert r.json()["handle"] == "rename.me"  # the handle is staff's to set
    page = (await client.get("/explore/creators/rename.me")).json()["creator"]
    assert page["display_name"] == "Meera Kamat"

    for bad in ("", " ", "A", "x" * 81):
        assert (await client.patch("/creators/me", json={"display_name": bad}, headers=headers)).status_code == 422
    # Not a way to change anything else.
    r = await client.patch("/creators/me", json={"display_name": "Meera K", "handle": "taken", "status": "paused"}, headers=headers)
    assert r.status_code == 200 and r.json()["handle"] == "rename.me" and r.json()["status"] == "active"
    assert (await client.patch("/creators/me", json={"display_name": "No Login"})).status_code == 401


async def test_destinations_show_the_creator_trips_that_went_there(client, admin, fake_reel):
    staff = auth(admin)
    country = (
        await client.post(
            "/admin/locations",
            json={"type": "country", "name": "India", "status": "published"},
            headers=staff,
        )
    ).json()
    goa = (
        await client.post(
            "/admin/locations",
            json={"type": "city", "name": "Goa", "parent_id": country["id"], "status": "published"},
            headers=staff,
        )
    ).json()
    await client.post(
        "/admin/locations",
        json={"type": "attraction", "name": "Fort Aguada", "parent_id": goa["id"], "status": "published"},
        headers=staff,
    )
    before = [d for d in (await client.get("/explore/destinations")).json() if d["name"] == "Goa"][0]
    assert before["creator_trips"] == 0 and before["cover_image_url"] is None and before["top_creator"] is None

    headers = await _approved_creator(client, admin, "goa@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()
    await client.patch(
        f"/creators/{me['id']}", json={"handle": "goa.diaries", "display_name": "Goa Diaries"}, headers=staff
    )
    await _publish_trips(client, headers, [REEL])  # the canned reel is a Goa trip
    after = [d for d in (await client.get("/explore/destinations")).json() if d["name"] == "Goa"][0]
    assert after["creator_trips"] == 1
    assert after["top_creator"] == {
        "slug": "goa.diaries",
        "handle": "goa.diaries",
        "display_name": "Goa Diaries",
    }


async def test_a_creator_without_a_handle_is_shown_at_their_referral_code(client, admin, fake_reel):
    staff = auth(admin)
    headers = await _approved_creator(client, admin, "nohandle@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()
    await client.patch(
        f"/creators/{me['id']}", json={"display_name": "Santosh Bhagat"}, headers=staff
    )
    trip = await _make_trip(client, headers)
    await client.patch(f"/creator/trips/{trip['id']}", json={"publish": True}, headers=headers)

    # Staff haven't set a handle, and the creator is still on the page: their page is their
    # referral code, and the name is what is shown.
    index = (await client.get("/explore/creators")).json()
    card = next(c for c in index["all"] if c["display_name"] == "Santosh Bhagat")
    assert card["handle"] is None and card["slug"] == me["referral_code"]
    page = await client.get(f"/explore/creators/{me['referral_code']}")
    assert page.status_code == 200 and page.json()["creator"]["display_name"] == "Santosh Bhagat"

    # Staff can feature their trip, and the staff list shows the name (no handle to show).
    state = (await client.get("/spotlight", headers=staff)).json()
    row = next(t for t in state["trips"] if t["trip_id"] == trip["id"])
    assert row["creator_name"] == "Santosh Bhagat" and row["creator_handle"] is None
    r = await client.put(f"/spotlight/trips/{trip['id']}", json={"on": True}, headers=staff)
    assert r.status_code == 200 and r.json()["chosen_trip_id"] == trip["id"]
    assert (await client.get("/explore/creators")).json()["spotlight"]["slug"] == me["referral_code"]

    # Once a handle is set, the page moves to it.
    await client.patch(f"/creators/{me['id']}", json={"handle": "santosh.b"}, headers=staff)
    card = next(c for c in (await client.get("/explore/creators")).json()["all"] if c["display_name"] == "Santosh Bhagat")
    assert card["slug"] == "santosh.b" and card["handle"] == "santosh.b"


async def test_staff_add_reels_for_a_creator_the_way_the_creator_would(client, admin, fake_reel):
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.modules.audit.models import AuditLog

    headers = await _approved_creator(client, admin, "forher@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()
    staff = {**auth(admin), "X-Act-As-Creator": me["id"]}

    # Staff make the link, and it is the creator's: they see it in their own workspace.
    r = await client.post("/creator/links", json={"label": "Goa for Mum"}, headers=staff)
    assert r.status_code == 201, r.text
    link = r.json()
    mine = (await client.get("/creator/links", headers=headers)).json()
    assert [x["id"] for x in mine] == [link["id"]] and mine[0]["label"] == "Goa for Mum"
    assert [x["id"] for x in (await client.get("/creator/links", headers=staff)).json()] == [link["id"]]

    # Staff add the reel; it is read into an itinerary under the creator's account.
    r = await client.patch(f"/creator/links/{link['id']}", json={"instagram_url": REEL}, headers=staff)
    assert r.status_code == 200, r.text
    trips = (await client.get("/creator/trips", headers=headers)).json()
    assert len(trips) == 1 and [i["name"] for i in trips[0]["items"]] == ["Fort Aguada", "Thalassa"]
    assert (await client.get(f"/creator/trips/{trips[0]['id']}", headers=staff)).status_code == 200

    # …and publish it, change its cover options, exactly as the creator could.
    r = await client.patch(f"/creator/links/{link['id']}", json={"published": True}, headers=staff)
    assert r.status_code == 200 and r.json()["status"] == "published"
    assert (await client.get(f"/creator/trips/{trips[0]['id']}/cover-options", headers=staff)).status_code == 200

    # Every change staff made is on the audit trail, with who did it.
    async with SessionLocal() as session:
        rows = (await session.scalars(select(AuditLog).where(AuditLog.action == "act_as"))).all()
    assert len(rows) >= 3 and {r.user_email for r in rows} == {"admin@example.com"}
    assert all(r.entity_id and str(r.entity_id) == me["id"] for r in rows)
    assert any(r.changes["method"] == "POST" for r in rows) and all(r.changes["path"] for r in rows)


async def test_only_staff_can_act_as_a_creator(client, admin, fake_reel, traveler):
    one = await _approved_creator(client, admin, "one.act@creators.example.com")
    two = await _approved_creator(client, admin, "two.act@creators.example.com")
    one_me = (await client.get("/creators/me", headers=one)).json()

    # Another creator, or a traveller, cannot work in someone else's workspace.
    for who in (two, auth(traveler)):
        r = await client.post("/creator/links", json={"label": "Not mine"}, headers={**who, "X-Act-As-Creator": one_me["id"]})
        assert r.status_code == 403, r.text
    assert (await client.get("/creator/links", headers=one)).json() == []

    # Staff without the header are not a creator; with a bad or unknown id there is no workspace.
    staff = auth(admin)
    assert (await client.get("/creator/links", headers=staff)).status_code == 404
    for bad in ("not-a-uuid", "00000000-0000-0000-0000-000000000000"):
        r = await client.get("/creator/links", headers={**staff, "X-Act-As-Creator": bad})
        assert r.status_code == 404, bad


async def test_staff_cannot_work_for_an_unapproved_creator_or_one_with_no_account(client, admin, fake_reel):
    from app.db.session import SessionLocal
    from app.modules.creators.models import Creator

    staff = auth(admin)
    # Waiting for approval: the same refusal the creator would get, but worded for staff.
    await client.post("/auth/creator/request-otp", json={"email": "waiting@creators.example.com"})
    r = await client.post("/auth/creator/verify", json={"email": "waiting@creators.example.com", "code": OTP})
    pending = (await client.get("/creators/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).json()
    r = await client.post("/creator/links", json={"label": "x"}, headers={**staff, "X-Act-As-Creator": pending["id"]})
    assert r.status_code == 403 and "creator's creator account" in r.json()["detail"]

    # A creator staff added by hand, who has never signed in, has no account to keep trips under.
    async with SessionLocal() as session:
        ghost = Creator(handle="ghost.creator", display_name="Ghost", referral_code="ghostcode1")
        session.add(ghost)
        await session.commit()
        ghost_id = str(ghost.id)
    r = await client.get("/creator/links", headers={**staff, "X-Act-As-Creator": ghost_id})
    assert r.status_code == 400 and "hasn't signed in" in r.json()["detail"]
