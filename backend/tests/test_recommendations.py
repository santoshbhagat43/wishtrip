from tests.conftest import auth


async def test_semantic_search(client, traveler, london):
    r = await client.get("/search/semantic?q=street food market", headers=auth(traveler))
    assert r.json()["results"][0]["location"]["name"] == "Borough Market Food Walk"


async def test_profile_drives_ranking(client, traveler, london):
    h = auth(traveler)
    r = await client.put(
        "/profiles/me",
        json={
            "energy_level": 2,
            "budget_level": 1,
            "companions": "couple",
            "preferred_times": ["evening"],
            "interest_tag_ids": [london["tags"]["Scenic views"]],
        },
        headers=h,
    )
    assert r.status_code == 200
    recs = (await client.get(f"/recommendations?city_id={london['city']['id']}", headers=h)).json()
    names = [i["location"]["name"] for i in recs["items"]]
    assert names[0] == "Tower Bridge"
    # Expensive kayaking (cost 4) exceeds budget 1 + 1, so it is filtered out entirely.
    assert "Thames Kayaking" not in names
    assert "matches your interests" in recs["items"][0]["reasons"]


async def test_behavior_changes_ranking(client, traveler, london):
    h = auth(traveler)
    tower = london["places"]["Tower Bridge"]["id"]
    for _ in range(3):
        await client.post(
            "/profiles/me/events", json={"location_id": tower, "event_type": "skipped"}, headers=h
        )
    recs = (await client.get(f"/recommendations?city_id={london['city']['id']}", headers=h)).json()
    tower_item = next(i for i in recs["items"] if i["location"]["id"] == tower)
    assert tower_item["components"]["affinity"] == 0.0
    assert "you skipped or removed this before" in tower_item["warnings"]


async def test_family_hard_constraint(client, traveler, london):
    h = auth(traveler)
    await client.put("/profiles/me", json={"companions": "family"}, headers=h)
    recs = (await client.get(f"/recommendations?city_id={london['city']['id']}", headers=h)).json()
    assert "Thames Kayaking" not in [i["location"]["name"] for i in recs["items"]]


async def test_admin_preview(client, editor, traveler, london):
    r = await client.get(
        f"/admin/recommendations/preview?user_id={traveler.id}&city_id={london['city']['id']}",
        headers=auth(editor),
    )
    assert r.status_code == 200
    assert set(r.json()["weights"]) >= {"interest", "semantic", "energy"}


async def test_explore_is_public_and_published_only(client, editor, london):
    # Drafts never appear; internal fields never leak.
    await client.post(
        "/admin/locations",
        json={"type": "attraction", "name": "Secret draft", "parent_id": london["city"]["id"]},
        headers=auth(editor),
    )
    dests = (await client.get("/explore/destinations")).json()
    london_dest = next(d for d in dests if d["name"] == "London")
    assert london_dest["country"] == "United Kingdom" and london_dest["place_count"] == 3

    detail = (await client.get(f"/explore/destinations/{london['city']['id']}")).json()
    names = [p["name"] for p in detail["places"]]
    assert "Secret draft" not in names and "Tower Bridge" in names
    assert not {"provenance", "source", "reference", "status"} & set(detail["places"][0])

    tower = london["places"]["Tower Bridge"]["id"]
    place = (await client.get(f"/explore/places/{tower}")).json()
    assert place["duration_minutes"] == 90 and "reference" not in place
    tags = (await client.get("/explore/tags")).json()
    assert {t["name"] for t in tags} >= {"Scenic views", "Street food"}


async def test_saved_places_follow_the_latest_signal(client, traveler, london):
    h = auth(traveler)
    tower = london["places"]["Tower Bridge"]["id"]
    market = london["places"]["Borough Market Food Walk"]["id"]
    for loc, event in ((tower, "added"), (market, "added"), (market, "removed")):
        await client.post(
            "/profiles/me/events", json={"location_id": loc, "event_type": event}, headers=h
        )
    saved = (await client.get("/profiles/me/saved", headers=h)).json()
    assert [s["place"]["name"] for s in saved] == ["Tower Bridge"]
    assert (await client.get("/profiles/me/saved")).status_code == 401
