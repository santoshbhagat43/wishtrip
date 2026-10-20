"""Traveler ticket thread: ownership, public messages only, follow-ups."""

from tests.conftest import auth, sign_up


async def test_traveler_reads_own_thread_without_internal_notes(client, support, traveler):
    th = auth(traveler)
    opened = await client.post(
        "/support/tickets",
        headers=th,
        json={"subject": "Airport pickup question", "body": "Can someone confirm the time?"},
    )
    assert opened.status_code == 201, opened.text
    ticket_id = opened.json()["id"]

    sh = auth(support)
    note = await client.post(
        f"/admin/support/tickets/{ticket_id}/reply",
        headers=sh,
        json={"body": "Staff-only reminder", "internal": True},
    )
    assert note.status_code == 201, note.text
    public = await client.post(
        f"/admin/support/tickets/{ticket_id}/reply",
        headers=sh,
        json={"body": "Yes — we will confirm by evening.", "internal": False},
    )
    assert public.status_code == 201, public.text

    detail = await client.get(f"/support/tickets/{ticket_id}", headers=th)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["status"] == "waiting_customer"
    authors = [m["author"] for m in body["messages"]]
    assert "note" not in authors
    assert "customer" in authors
    assert "agent" in authors
    assert "Staff-only reminder" not in [m["body"] for m in body["messages"]]
    assert any(m["body"] == "Yes — we will confirm by evening." for m in body["messages"])
    assert "context" not in body


async def test_other_traveler_cannot_read_ticket(client, traveler, support):
    owner = await client.post(
        "/support/tickets",
        headers=auth(traveler),
        json={"subject": "Private ticket", "body": "Only I should see this"},
    )
    assert owner.status_code == 201
    ticket_id = owner.json()["id"]

    other = await sign_up(client, "other-traveler@example.com")
    assert other.status_code == 200, other.text
    other_h = {"Authorization": f"Bearer {other.json()['access_token']}"}

    peek = await client.get(f"/support/tickets/{ticket_id}", headers=other_h)
    assert peek.status_code == 404


async def test_traveler_follow_up_reopens_ticket(client, support, traveler):
    th = auth(traveler)
    opened = await client.post(
        "/support/tickets",
        headers=th,
        json={"subject": "Need a change", "body": "Please update day 2"},
    )
    ticket_id = opened.json()["id"]

    await client.post(
        f"/admin/support/tickets/{ticket_id}/reply",
        headers=auth(support),
        json={"body": "Done on our side.", "internal": False},
    )

    follow = await client.post(
        f"/support/tickets/{ticket_id}/messages",
        headers=th,
        json={"body": "Thanks — can you also move the hotel?"},
    )
    assert follow.status_code == 201, follow.text
    assert follow.json()["status"] == "open"
    bodies = [m["body"] for m in follow.json()["messages"]]
    assert "Thanks — can you also move the hotel?" in bodies


async def test_traveler_ticket_links_own_trip(client, traveler):
    th = auth(traveler)
    chat = (await client.post("/chat/sessions", headers=th)).json()
    opened = await client.post(
        "/support/tickets",
        headers=th,
        json={
            "subject": "Question about this trip",
            "body": "Can we start temples earlier?",
            "session_id": chat["id"],
        },
    )
    assert opened.status_code == 201, opened.text
    assert opened.json()["trip_title"] == chat["title"]


async def test_traveler_cannot_link_someone_elses_trip(client, traveler, admin):
    other_chat = (await client.post("/chat/sessions", headers=auth(admin))).json()
    denied = await client.post(
        "/support/tickets",
        headers=auth(traveler),
        json={
            "subject": "Steal this trip",
            "body": "Should not attach",
            "session_id": other_chat["id"],
        },
    )
    assert denied.status_code == 400
