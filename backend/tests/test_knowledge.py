from tests.conftest import auth


async def test_hierarchy_rules(client, editor, london):
    h = auth(editor)
    r = await client.post(
        "/admin/locations", json={"type": "attraction", "name": "Orphan"}, headers=h
    )
    assert r.status_code == 400
    r = await client.post(
        "/admin/locations",
        json={"type": "attraction", "name": "Wrong parent", "parent_id": london["uk"]["id"]},
        headers=h,
    )
    assert r.status_code == 400
    r = await client.post(
        "/admin/locations",
        json={"type": "city", "name": "Bad", "parent_id": london["city"]["id"]},
        headers=h,
    )
    assert r.status_code == 400


async def test_detail_completeness_and_ancestors(client, editor, london):
    tower = london["places"]["Tower Bridge"]
    r = await client.get(f"/admin/locations/{tower['id']}", headers=auth(editor))
    body = r.json()
    assert [a["name"] for a in body["ancestors"]] == ["United Kingdom", "London"]
    assert "description" in body["missing_fields"]
    assert 0 < body["completeness"] < 1
    assert body["embedded_at"] is not None  # inline embedding ran on publish


async def test_update_slug_and_audit(client, admin, editor, london):
    tower = london["places"]["Tower Bridge"]
    r = await client.patch(
        f"/admin/locations/{tower['id']}",
        json={"name": "Tower Bridge London"},
        headers=auth(editor),
    )
    assert r.json()["slug"] == "tower-bridge-london"
    log = (await client.get("/admin/audit-log?entity_type=location", headers=auth(admin))).json()
    assert log["items"][0]["action"] == "update"


async def test_list_filters(client, editor, london):
    h = auth(editor)
    r = await client.get(f"/admin/locations?parent_id={london['city']['id']}", headers=h)
    assert r.json()["total"] == 3
    r = await client.get("/admin/locations?type=experience&type=activity", headers=h)
    assert {i["name"] for i in r.json()["items"]} == {"Borough Market Food Walk", "Thames Kayaking"}
    r = await client.get("/admin/locations?q=borough", headers=h)
    assert r.json()["total"] == 1


async def test_relations(client, editor, london):
    h = auth(editor)
    a, b = london["places"]["Tower Bridge"], london["places"]["Borough Market Food Walk"]
    r = await client.post(
        f"/admin/locations/{a['id']}/relations",
        json={"target_id": b["id"], "relation": "near", "travel_minutes": 15},
        headers=h,
    )
    assert r.status_code == 201
    # Same relation in the reverse direction is a duplicate.
    r = await client.post(
        f"/admin/locations/{b['id']}/relations",
        json={"target_id": a["id"], "relation": "near"},
        headers=h,
    )
    assert r.status_code == 409
    r = await client.get(f"/admin/locations/{b['id']}/relations", headers=h)
    assert len(r.json()) == 1


async def test_cannot_delete_parent_with_children(client, editor, london):
    r = await client.delete(f"/admin/locations/{london['city']['id']}", headers=auth(editor))
    assert r.status_code == 409


async def test_media_upload(client, editor, london):
    tower = london["places"]["Tower Bridge"]
    r = await client.post(
        f"/admin/locations/{tower['id']}/media",
        data={"kind": "image", "caption": "At dusk"},
        files={"file": ("bridge.jpg", b"\xff\xd8fakejpeg", "image/jpeg")},
        headers=auth(editor),
    )
    assert r.status_code == 201, r.text
    assert r.json()["url"].startswith("/media/locations/")
    bad = await client.post(
        f"/admin/locations/{tower['id']}/media",
        data={"kind": "image"},
        files={"file": ("x.txt", b"hi", "text/plain")},
        headers=auth(editor),
    )
    assert bad.status_code == 400


async def test_stats(client, editor, london):
    stats = (await client.get("/admin/stats", headers=auth(editor))).json()
    assert stats["total"] == 5
    assert stats["embeddings_pending"] == 0
    assert stats["tags"] == 3
