"""Support role: inbox access, read-only staff GETs, no users/audit/KB writes."""

from tests.conftest import auth


async def test_support_can_read_locations_but_not_create(client, support, london):
    h = auth(support)
    listed = await client.get("/admin/locations", headers=h)
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1

    created = await client.post(
        "/admin/locations",
        headers=h,
        json={
            "type": "attraction",
            "name": "Support should not create",
            "parent_id": london["city"]["id"],
        },
    )
    assert created.status_code == 403


async def test_support_denied_users_and_audit_log(client, support):
    h = auth(support)
    assert (await client.get("/admin/users", headers=h)).status_code == 403
    assert (await client.get("/admin/audit-log", headers=h)).status_code == 403


async def test_editor_denied_audit_log_after_admin_only(client, editor):
    assert (await client.get("/admin/audit-log", headers=auth(editor))).status_code == 403


async def test_support_works_inbox_ticket(client, support, traveler):
    traveler_h = auth(traveler)
    opened = await client.post(
        "/support/tickets",
        headers=traveler_h,
        json={"subject": "Need help with my trip", "body": "Can you check my plan?"},
    )
    assert opened.status_code == 201, opened.text
    ticket_id = opened.json()["id"]

    support_h = auth(support)
    inbox = await client.get("/admin/support/inbox", headers=support_h)
    assert inbox.status_code == 200
    assert any(t["id"] == ticket_id for t in inbox.json()["items"])

    detail = await client.get(f"/admin/support/tickets/{ticket_id}", headers=support_h)
    assert detail.status_code == 200

    replied = await client.post(
        f"/admin/support/tickets/{ticket_id}/reply",
        headers=support_h,
        json={"body": "We are looking into it.", "internal": False},
    )
    assert replied.status_code == 201, replied.text

    resolved = await client.patch(
        f"/admin/support/tickets/{ticket_id}",
        headers=support_h,
        json={"status": "resolved"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"


async def test_traveler_cannot_list_admin_inbox(client, traveler):
    assert (await client.get("/admin/support/inbox", headers=auth(traveler))).status_code == 403


async def test_admin_can_create_support_user(client, admin):
    h = auth(admin)
    created = await client.post(
        "/admin/users",
        headers=h,
        json={
            "email": "new-support@example.com",
            "password": "password123",
            "full_name": "New Support",
            "role": "support",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["role"] == "support"


async def test_support_cannot_change_routing(client, support):
    h = auth(support)
    assert (await client.get("/admin/support/routing", headers=h)).status_code == 200
    denied = await client.put(
        "/admin/support/routing",
        headers=h,
        json={"method": "manual"},
    )
    assert denied.status_code == 403
