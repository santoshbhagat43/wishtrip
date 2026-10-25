from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.creators.models import Creator
from tests.conftest import auth, sign_up

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
    r = await client.post(
        "/auth/creator/verify", json={"email": "x@creators.example.com", "code": "9999"}
    )
    assert r.status_code == 400
    async with SessionLocal() as session:
        assert await session.scalar(select(Creator)) is None


async def test_second_login_reuses_the_account(client):
    await _creator_login(client, "repeat@creators.example.com")
    await _creator_login(client, "repeat@creators.example.com")
    async with SessionLocal() as session:
        creators = list(await session.scalars(select(Creator)))
    assert len(creators) == 1


async def test_staff_approve_a_pending_creator(client, admin):
    headers = await _creator_login(client, "pending@creators.example.com")

    pending = await client.get("/creators", params={"status": "pending"}, headers=auth(admin))
    assert pending.status_code == 200
    rows = pending.json()["items"]
    assert len(rows) == 1 and rows[0]["email"] == "pending@creators.example.com"

    approved = await client.patch(
        f"/creators/{rows[0]['id']}",
        json={
            "status": "active",
            "handle": "mayatravels",
            "commission_type": "percent",
            "commission_value": 1000,
        },
        headers=auth(admin),
    )
    assert approved.status_code == 200 and approved.json()["status"] == "active"

    mine = (await client.get("/creators/me", headers=headers)).json()
    assert mine["status"] == "active"
    assert mine["handle"] == "mayatravels"
    assert mine["commission_type"] == "percent"
    assert mine["commission_value"] == 1000


async def test_creator_cannot_use_staff_endpoints(client):
    headers = await _creator_login(client, "nosy@creators.example.com")
    assert (await client.get("/creators", headers=headers)).status_code == 403


async def test_traveler_has_no_creator_record(client, traveler):
    assert (await client.get("/creators/me", headers=auth(traveler))).status_code == 404


async def test_creator_overview_shows_their_numbers_but_never_traveller_emails(client):
    """The creator's own dashboard: same data as the staff view, without other people's emails."""
    headers = await _creator_login(client, "overview@creators.example.com")
    me = (await client.get("/creators/me", headers=headers)).json()

    # A traveller signs up through this creator's link.
    signup = await sign_up(
        client,
        "brought-in@example.com",
        referral_code=me["referral_code"],
        visitor_id="v-overview",
    )
    assert signup.status_code == 200

    r = await client.get("/creators/me/overview", headers=headers)
    assert r.status_code == 200, r.text
    overview = r.json()
    assert overview["referral_code"] == me["referral_code"]
    assert overview["stats"]["credited_travellers"] == 1
    assert overview["activity"], "the sign-up shows in their activity"
    assert all(a["user_email"] is None for a in overview["activity"])
    assert "brought-in@example.com" not in r.text
    assert "notes" not in overview


async def test_creator_overview_is_only_for_creators(client, traveler):
    r = await client.get("/creators/me/overview", headers=auth(traveler))
    assert r.status_code == 404
    assert (await client.get("/creators/me/overview")).status_code == 401


async def _apply(client, **fields):
    body = {"email": "channels@creators.example.com", "name": "Channels", **fields}
    return await client.post("/creators/apply", json=body)


async def _applied(email: str = "channels@creators.example.com") -> Creator:
    async with SessionLocal() as session:
        return await session.scalar(select(Creator).where(Creator.email == email))


async def test_a_creator_can_apply_with_instagram_only(client):
    assert (await _apply(client, handle="@meera.travels")).status_code == 202
    creator = await _applied()
    assert creator.handle == "meera.travels"
    assert creator.profile_url == "https://www.instagram.com/meera.travels/"
    assert creator.youtube_url is None


async def test_a_creator_can_apply_with_youtube_only(client):
    assert (await _apply(client, youtube="@MeeraTravels")).status_code == 202
    creator = await _applied()
    assert creator.handle is None
    assert creator.youtube_url == "https://www.youtube.com/@MeeraTravels"


async def test_a_creator_can_apply_with_both_channels(client):
    r = await _apply(client, handle="meera.travels", youtube="youtube.com/@meeratravels")
    assert r.status_code == 202
    creator = await _applied()
    assert creator.handle == "meera.travels"
    assert creator.youtube_url == "https://www.youtube.com/@meeratravels"


async def test_at_least_one_channel_is_needed(client):
    r = await _apply(client)
    assert r.status_code == 400
    assert "Instagram" in r.json()["detail"] and "YouTube" in r.json()["detail"]
    assert await _applied() is None, "nothing was created"
    # Blank or whitespace-only counts as nothing.
    assert (await _apply(client, handle="  ", youtube="")).status_code == 400


async def test_pasted_links_are_turned_into_handles_and_canonical_urls(client):
    r = await _apply(
        client,
        handle="https://www.instagram.com/meera.travels/?igsh=abc",
        youtube="https://m.youtube.com/channel/UCabcdefghijklmnopqrstuv?si=x",
    )
    assert r.status_code == 202, r.text
    creator = await _applied()
    assert creator.handle == "meera.travels"
    assert creator.youtube_url == "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"


async def test_things_that_are_not_channels_are_refused_with_a_clear_message(client):
    r = await _apply(client, handle="not a handle!")
    assert r.status_code == 400 and "Instagram handle" in r.json()["detail"]
    r = await _apply(client, youtube="https://example.com/watch?v=1")
    assert r.status_code == 400 and "YouTube channel" in r.json()["detail"]
    assert await _applied() is None


async def test_reapplying_can_add_a_channel_but_never_replaces_one(client):
    await _apply(client, handle="meera.travels")
    await _apply(client, handle="someone.else", youtube="@meeratravels")
    creator = await _applied()
    assert creator.handle == "meera.travels"
    assert creator.youtube_url == "https://www.youtube.com/@meeratravels"


async def test_a_creator_sees_their_own_channels_on_their_dashboard(client):
    await _apply(client, email="mine@creators.example.com", handle="mine.insta", youtube="@mine")
    headers = await _creator_login(client, "mine@creators.example.com")
    overview = (await client.get("/creators/me/overview", headers=headers)).json()
    assert overview["handle"] == "mine.insta"
    assert overview["youtube_url"] == "https://www.youtube.com/@mine"


async def test_an_instagram_handle_already_registered_is_a_clear_conflict_not_a_crash(client):
    assert (
        await _apply(client, email="first@creators.example.com", handle="shared.handle")
    ).status_code == 202
    r = await _apply(client, email="second@creators.example.com", handle="@Shared.handle")
    assert r.status_code == 409, r.text
    assert "@shared.handle is already registered" in r.json()["detail"]
    assert await _applied("second@creators.example.com") is None
    # The same person re-applying with their own handle is not a conflict with themselves.
    assert (
        await _apply(client, email="first@creators.example.com", handle="shared.handle")
    ).status_code == 202


async def test_staff_search_and_page_through_creators(client, admin):
    staff = auth(admin)
    emails = [f"person{n:02d}@creators.example.com" for n in range(25)]
    for email in emails:
        await client.post("/auth/creator/request-otp", json={"email": email})
        await client.post("/auth/creator/verify", json={"email": email, "code": OTP})
    mine = (await client.get("/creators", params={"page_size": 100}, headers=staff)).json()
    assert mine["total"] == 25
    named = next(c for c in mine["items"] if c["email"] == "person07@creators.example.com")
    await client.patch(
        f"/creators/{named['id']}",
        json={"handle": "slow.goa_trips", "display_name": "Meera 100% Kamat"},
        headers=staff,
    )

    # Pages: 20 then 5, newest first, nothing repeated.
    first = (await client.get("/creators", headers=staff)).json()
    second = (await client.get("/creators", params={"page": 2}, headers=staff)).json()
    assert (first["page"], first["page_size"], first["total"]) == (1, 20, 25)
    assert len(first["items"]) == 20 and len(second["items"]) == 5
    seen = [c["id"] for c in first["items"] + second["items"]]
    assert len(set(seen)) == 25
    assert (await client.get("/creators", params={"page": 3}, headers=staff)).json()["items"] == []
    small = (await client.get("/creators", params={"page_size": 10, "page": 3}, headers=staff)).json()
    assert len(small["items"]) == 5 and small["total"] == 25

    async def find(q: str, **extra):
        r = await client.get("/creators", params={"q": q, **extra}, headers=staff)
        assert r.status_code == 200, r.text
        return r.json()

    # By handle (with or without @), name, email and part of a word; case doesn't matter.
    for q in ("slow.goa", "@SLOW.goa_trips", "100% kam", "person07", "PERSON07@creators"):
        found = await find(q)
        assert found["total"] == 1 and found["items"][0]["id"] == named["id"], q
    assert (await find("person0"))["total"] == 10  # person00 to person09
    assert (await find("person0", page_size=4, page=3))["items"].__len__() == 2
    # % and _ are searched for as text, not treated as wildcards.
    assert (await find("%"))["total"] == 1 and (await find("_"))["total"] == 1
    assert (await find("nobody-has-this"))["total"] == 0
    # Search and the status filter work together.
    assert (await find("person", status="pending"))["total"] == 25
    assert (await find("person", status="active"))["total"] == 0
    # Staff only, and sensible limits.
    assert (await client.get("/creators", params={"q": "x"})).status_code == 401
    assert (await client.get("/creators", params={"page": 0}, headers=staff)).status_code == 422
    assert (await client.get("/creators", params={"page_size": 101}, headers=staff)).status_code == 422
