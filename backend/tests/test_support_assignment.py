"""Assignment permissions: admin/editor full control; support claim-only."""

from tests.conftest import auth


async def _open_unassigned(client, admin, traveler, subject: str = "Need assignment help"):
    """Create a ticket and clear any auto-routing assignee."""
    opened = await client.post(
        "/support/tickets",
        headers=auth(traveler),
        json={"subject": subject, "body": "Please assign this."},
    )
    assert opened.status_code == 201, opened.text
    ticket_id = opened.json()["id"]
    cleared = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=auth(admin),
        json={"assignee_id": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["assignee"] is None
    return ticket_id


async def test_admin_can_assign_reassign_and_unassign(client, admin, support, traveler):
    ticket_id = await _open_unassigned(client, admin, traveler)
    ah = auth(admin)

    assigned = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=ah,
        json={"assignee_id": str(support.id)},
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assignee"]["id"] == str(support.id)

    other = await client.post(
        "/admin/users",
        headers=ah,
        json={
            "email": "support-b@example.com",
            "password": "password123",
            "full_name": "Support B",
            "role": "support",
        },
    )
    assert other.status_code == 201, other.text
    other_id = other.json()["id"]

    reassigned = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=ah,
        json={"assignee_id": other_id},
    )
    assert reassigned.status_code == 200
    assert reassigned.json()["assignee"]["id"] == other_id

    unassigned = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=ah,
        json={"assignee_id": None},
    )
    assert unassigned.status_code == 200
    assert unassigned.json()["assignee"] is None


async def test_editor_keeps_admin_like_assignment(client, admin, editor, support, traveler):
    ticket_id = await _open_unassigned(client, admin, traveler, "Editor assign")
    assigned = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=auth(editor),
        json={"assignee_id": str(support.id)},
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assignee"]["id"] == str(support.id)


async def test_support_can_claim_unassigned_only(client, admin, support, traveler):
    ticket_id = await _open_unassigned(client, admin, traveler, "Claim me")
    sh = auth(support)

    claimed = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=sh,
        json={"assignee_id": str(support.id)},
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["assignee"]["id"] == str(support.id)

    # Cannot unassign self.
    denied_unassign = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=sh,
        json={"assignee_id": None},
    )
    assert denied_unassign.status_code == 403


async def test_support_cannot_assign_to_other_or_take_over(client, admin, support, traveler):
    ticket_id = await _open_unassigned(client, admin, traveler, "Do not steal")
    ah = auth(admin)
    other = await client.post(
        "/admin/users",
        headers=ah,
        json={
            "email": "support-yash@example.com",
            "password": "password123",
            "full_name": "Yash",
            "role": "support",
        },
    )
    assert other.status_code == 201
    yash_id = other.json()["id"]

    # Cannot assign unassigned ticket to someone else.
    denied_other = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=auth(support),
        json={"assignee_id": yash_id},
    )
    assert denied_other.status_code == 403

    await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=ah,
        json={"assignee_id": yash_id},
    )

    # Cannot take over Yash's ticket — it is not in this agent's inbox.
    denied_takeover = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=auth(support),
        json={"assignee_id": str(support.id)},
    )
    assert denied_takeover.status_code == 404
    still = await client.get(f"/admin/support/tickets/{ticket_id}", headers=ah)
    assert still.json()["assignee"]["id"] == yash_id


async def test_support_inbox_hides_other_agents_tickets(client, admin, support, traveler):
    theirs = await _open_unassigned(client, admin, traveler, "Assigned to admin")
    await client.patch(
        f"/admin/support/tickets/{theirs}",
        headers=auth(admin),
        json={"assignee_id": str(admin.id)},
    )
    mine = await _open_unassigned(client, admin, traveler, "Assigned to me")
    await client.patch(
        f"/admin/support/tickets/{mine}",
        headers=auth(admin),
        json={"assignee_id": str(support.id)},
    )
    free = await _open_unassigned(client, admin, traveler, "Unassigned for anyone")

    support_inbox = await client.get(
        "/admin/support/inbox",
        headers=auth(support),
        params={"view": "open"},
    )
    assert support_inbox.status_code == 200
    ids = {t["id"] for t in support_inbox.json()["items"]}
    assert theirs not in ids
    assert mine in ids
    assert free in ids
    assert support_inbox.json()["counts"]["open"] >= 2

    admin_inbox = await client.get(
        "/admin/support/inbox",
        headers=auth(admin),
        params={"view": "open"},
    )
    admin_ids = {t["id"] for t in admin_inbox.json()["items"]}
    assert theirs in admin_ids
    assert mine in admin_ids
    assert free in admin_ids

    hidden = await client.get(
        f"/admin/support/tickets/{theirs}",
        headers=auth(support),
    )
    assert hidden.status_code == 404
