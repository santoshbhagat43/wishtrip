"""Building a trip for a party: the planning rules for each kind of group, the checks on what the
AI returns, the fallback without it, and the Details -> Build my trip flow."""

import json

import pytest
from sqlalchemy import select

from app.db.session import SessionLocal
from app.modules.creators import builder, mine
from app.modules.creators.models import TravellerTrip
from app.modules.reels.models import CreatorContent, ImportStatus, ReelImport
from tests.conftest import auth, trip_details

PLACES = [
    {"name": "Tanah Lot", "kind": "sight", "evidence": "sunset temple", "verified": True, "t": 4},
    {"name": "Tegalalang Rice Terrace", "kind": "sight", "evidence": "green terraces", "verified": False, "t": 9},
    {"name": "Locavore", "kind": "food", "evidence": "dinner", "verified": False, "t": 14},
    {"name": "Nusa Penida", "kind": "experience", "evidence": "day trip", "verified": False, "t": 20},
    {"name": "Grand Mega Resort & Spa", "kind": "stay", "evidence": "", "verified": False, "t": 25},
    {"name": "Kuta", "kind": "area", "evidence": "", "verified": False, "t": 1},
]  # fmt: skip


def test_each_group_gets_its_own_rules_after_the_basic_ones():
    assert builder.persona("couple", 2, 0, 0) == "couple"
    assert builder.persona("", 1, 0, 0) == "solo"
    assert builder.persona("family", 2, 2, 0) == "family"
    assert builder.persona("seniors", 0, 0, 2) == "elderly"
    assert builder.persona("", 2, 0, 1) == "flexible"  # seniors with others: a mixed group
    assert builder.persona("", 2, 1, 1) == "flexible"
    assert builder.persona("friends", 4, 0, 0) == "flexible"
    assert builder.persona("couple", 3, 0, 0) == "flexible"  # "couple" but not two people
    for who in builder.PERSONAS:
        text = builder.rules(who)
        assert text.startswith("Create a practical and well-structured trip itinerary")  # basic.txt
        assert builder.rules_file(who) in text
    assert "romantic" in builder.rules("couple") and "romantic" not in builder.rules("solo")
    assert "Very relaxed" in builder.rules("elderly") and "kids" in builder.rules("family").lower()


def must():
    return [
        {**p, "id": f"p{i}", "origin": "reel", "note": p["evidence"], "location_id": None}
        for i, p in enumerate(PLACES)
        if p["kind"] != "area"
    ]


def good_plan(days=3):
    """What a sound AI answer looks like: every place once, a few extras, a few tips."""
    return {
        "summary": "A slow trip around Bali.",
        "days": [
            {"day": 1, "title": "Arrive", "items": [
                {"name": "Grand Mega Resort & Spa", "kind": "stay", "slot": "afternoon", "note": "Check in"},
                {"name": "Tanah Lot", "kind": "sight", "slot": "evening", "note": "Sunset", "from_reel": True},
                {"name": "Beach walk", "kind": "sight", "slot": "morning", "optional": True, "from_reel": False}]},
            {"day": 2, "title": "Ubud", "items": [
                {"name": "Tegalalang Rice Terrace", "kind": "sight", "slot": "morning"},
                {"name": "Locavore", "kind": "food", "slot": "evening"}]},
            {"day": 3, "title": "Islands", "items": [
                {"name": "Nusa Penida", "kind": "experience", "slot": "morning"}]},
        ][:days],
        "tips": ["Book the Nusa Penida boat the day before.", "  "],
    }  # fmt: skip


class FakeAI:
    enabled = True

    def __init__(self, answer):
        self.answer, self.sent = answer, []

    async def complete(self, task, messages, **kwargs):
        self.sent.append(messages)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)


async def build(ai, group="couple", adults=2, kids=0, seniors=0, days=3):
    return await builder.build(
        ai, must=must(), destination="Bali", days=days, adults=adults, kids=kids, seniors=seniors,
        pace="relaxed", when="", group=group, summary="A Bali trip",
    )  # fmt: skip


async def test_the_ai_is_given_the_rules_and_the_facts_and_its_plan_is_kept():
    ai = FakeAI(good_plan())
    plan = await build(ai, group="family", adults=2, kids=2)
    system, user = ai.sent[0][0]["content"], ai.sent[0][1]["content"]
    assert "Create a practical and well-structured trip itinerary" in system  # basic rules
    assert "family-friendly itinerary" in system and "Backup indoor options" in system  # family rules
    assert "romantic" not in system
    facts = json.loads(user.split("Facts:\n", 1)[1])
    assert facts["days"] == 3 and facts["travellers"] == {"adults": 2, "children": 2, "seniors": 0}
    assert {m["name"] for m in facts["must_include"]} == {"Tanah Lot", "Tegalalang Rice Terrace", "Locavore", "Nusa Penida", "Grand Mega Resort & Spa"}
    assert "price" not in user.lower() or "no prices" in system.lower()

    assert plan["ai_built"] and plan["persona"] == "family" and plan["summary"] == "A slow trip around Bali."
    assert plan["tips"] == ["Book the Nusa Penida boat the day before."]
    items = plan["items"]
    assert sorted(i["day"] for i in items)[0] == 1 and max(i["day"] for i in items) == 3
    by = {i["name"]: i for i in items}
    assert by["Tanah Lot"]["origin"] == "reel" and by["Tanah Lot"]["slot"] == "evening"
    assert by["Beach walk"]["origin"] == "suggested" and by["Beach walk"]["optional"]  # labelled, not from the reel
    assert by["Grand Mega Resort & Spa"]["kind"] == "stay" and by["Grand Mega Resort & Spa"]["day"] == 1


async def test_a_place_the_ai_leaves_out_is_put_back_and_extras_stay_within_the_limit():
    plan = good_plan()
    plan["days"][0]["items"] = [i for i in plan["days"][0]["items"] if i["name"] != "Tanah Lot"]  # dropped
    plan["days"][2]["items"] += [
        {"name": n, "kind": "sight", "slot": "afternoon", "from_reel": False}
        for n in ("Spice garden", "Monkey forest", "Coffee plantation", "Waterfall hike")
    ]  # too many on day 3
    out = await build(FakeAI(plan))
    names = [i["name"] for i in out["items"]]
    assert names.count("Tanah Lot") == 1  # nothing from the reel is lost
    day3 = [i for i in out["items"] if i["day"] == 3 and i["kind"] in ("sight", "experience")]
    assert sum(1 for i in day3 if not i["optional"]) <= 3  # at most three main activities a day
    assert sum(1 for i in day3 if i["optional"]) >= 2  # the surplus extras were made optional


@pytest.mark.parametrize("answer", ["not json at all", {"days": []}, {"days": [{"day": 1, "items": []}]}, RuntimeError("down")])
async def test_without_a_usable_answer_the_places_are_arranged_by_rule(answer):
    plan = await build(FakeAI(answer))
    assert plan["ai_built"] is False and plan["tips"] == []
    places = [i for i in plan["items"] if i["kind"] in ("sight", "experience", "stay") or i["origin"] == "reel"]
    names = {i["name"] for i in places}
    assert names == {m["name"] for m in must()}  # every place, once, and no invented ones
    assert {i["day"] for i in plan["items"]} <= {1, 2, 3}
    # Besides the reel's places, only the plain things every trip needs: travel, meals, check-out.
    extras = [i for i in plan["items"] if i not in places]
    assert {i["kind"] for i in extras} <= {"travel", "food", "note"}
    assert all(i["origin"] == "suggested" for i in extras)
    stay = next(i for i in plan["items"] if i["kind"] == "stay")
    assert stay["day"] == 1
    for d in (1, 2, 3):
        assert sum(1 for i in plan["items"] if i["day"] == d and i["kind"] in ("sight", "experience")) <= 3


async def test_no_ai_at_all_arranges_by_rule():
    plan = await build(None, group="", adults=1)
    assert plan["ai_built"] is False and plan["persona"] == "solo"


async def _import_for(user):
    async with SessionLocal() as session:
        content = CreatorContent(shortcode="DbuildTest", url="https://www.instagram.com/reel/DbuildTest/",
                                 destination_name="Bali", places=PLACES, extracted={"summary": "A slow trip"})  # fmt: skip
        session.add(content)
        await session.flush()
        job = ReelImport(url=content.url, shortcode="DbuildTest", user_id=user.id, content_id=content.id,
                         status=ImportStatus.DONE)  # fmt: skip
        session.add(job)
        await session.commit()
        return job.id


async def test_build_my_trip_from_a_reel_starts_a_build_and_the_trip_fills_in(client, traveler, builds, monkeypatch):
    job_id = await _import_for(traveler)
    body = {**trip_details(), "adults": 2, "kids": 2, "days": 3, "pace": "relaxed", "group": "family", "when": "Dec 12"}

    r = await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))
    assert r.status_code == 201, r.text
    trip = r.json()
    assert len(trip["code"]) == 8 and trip["build_status"] == "building" and trip["persona"] == "family"
    assert trip["destination_name"] == "Bali" and trip["group"] == "family"
    assert builds == [trip["code"]]  # queued to a worker
    # Until the plan is ready it shows the reel's own places (not the "area").
    assert {i["name"] for i in trip["items"]} == {m["name"] for m in must()}

    # The worker plans it.
    monkeypatch.setattr(mine, "allow", lambda *a, **k: _true())
    async with SessionLocal() as session:
        await mine.run_build(session, FakeAI(good_plan()), trip["code"])
    got = (await client.get(f"/my-trips/{trip['code']}")).json()
    assert got["build_status"] == "ready" and got["ai_built"] and got["persona"] == "family"
    assert got["plan_summary"] == "A slow trip around Bali." and got["tips"] == ["Book the Nusa Penida boat the day before."]
    assert max(i["day"] for i in got["items"]) == 3
    assert next(i for i in got["items"] if i["name"] == "Tanah Lot")["slot"] == "evening"

    # Changing who is going plans it again; only the dates do not.
    r = await client.patch(f"/my-trips/{trip['code']}", json={**body, "when": "Jan 3"})
    assert r.json()["build_status"] == "ready" and builds == [trip["code"]]  # not rebuilt
    r = await client.patch(f"/my-trips/{trip['code']}", json={**body, "kids": 0, "group": "couple"})
    assert r.json()["build_status"] == "building" and r.json()["persona"] == "couple" and len(builds) == 2


async def _true():
    return True


async def test_a_failed_build_says_so_and_can_be_tried_again(client, traveler, builds, monkeypatch):
    job_id = await _import_for(traveler)
    r = await client.post(f"/reels/imports/{job_id}/build", json={**trip_details(), "adults": 2, "days": 3}, headers=auth(traveler))
    code = r.json()["code"]

    async def boom(*a, **k):
        raise RuntimeError("planner exploded")

    monkeypatch.setattr(builder, "build", boom)
    monkeypatch.setattr(mine, "allow", lambda *a, **k: _true())
    async with SessionLocal() as session:
        await mine.run_build(session, FakeAI(good_plan()), code)
    got = (await client.get(f"/my-trips/{code}")).json()
    assert got["build_status"] == "failed" and got["build_error"] and len(got["items"]) == 5  # kept its stops
    again = await client.patch(f"/my-trips/{code}", json={**trip_details(), "adults": 2, "days": 3})  # same details: retry anyway
    assert again.json()["build_status"] == "building" and builds.count(code) == 2


async def test_only_the_traveller_whose_reel_it_is_can_build_from_it(client, traveler, editor):
    job_id = await _import_for(traveler)
    assert (await client.post(f"/reels/imports/{job_id}/build", json={"adults": 2, **trip_details()}, headers=auth(editor))).status_code == 404
    assert (await client.post(f"/reels/imports/{job_id}/build", json=trip_details())).status_code == 401
    async with SessionLocal() as session:
        job = await session.get(ReelImport, job_id)
        job.status = ImportStatus.RUNNING
        await session.commit()
    assert (await client.post(f"/reels/imports/{job_id}/build", json={"adults": 2, **trip_details()}, headers=auth(traveler))).status_code == 409
    assert (await client.post(f"/reels/imports/{job_id}/build", json={**trip_details(), "adults": 0, "kids": 0}, headers=auth(traveler))).status_code in (400, 409)
    async with SessionLocal() as session:
        assert (await session.scalars(select(TravellerTrip))).all() == []


async def test_the_trip_knows_when_it_starts_and_where_from(client, traveler, builds):
    import datetime as dt

    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=40)
    body = {**trip_details(), "adults": 2, "days": 3, "pace": "relaxed", "group": "couple",
            "start_date": start.isoformat(), "origin": "del", "origin_city": " New   Delhi "}  # fmt: skip
    r = await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))
    assert r.status_code == 201, r.text
    trip = r.json()
    assert trip["start_date"] == start.isoformat()
    assert trip["end_date"] == (start + dt.timedelta(days=2)).isoformat()  # a 3-day plan
    assert (trip["origin"], trip["origin_city"]) == ("DEL", "New Delhi")
    assert str(start.day) in trip["when"] and "–" in trip["when"]  # shown as a range

    # Changing the dates or the city does not plan the trip again (they don't change the plan).
    later = (start + dt.timedelta(days=7)).isoformat()
    async with SessionLocal() as session:
        row = await session.scalar(select(TravellerTrip))
        row.build_status = "ready"
        await session.commit()
    r = await client.patch(f"/my-trips/{trip['code']}", json={**body, "start_date": later, "origin": "BOM", "origin_city": "Mumbai"})
    assert r.json()["start_date"] == later and r.json()["origin"] == "BOM" and r.json()["build_status"] == "ready"
    assert builds == [trip["code"]]

    # A trip board needs all of it: no date, no from-city, no grown-up, a past date or an odd
    # code is refused (and the trip keeps the details it had).
    past = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    for bad in ({"start_date": None}, {"origin": "", "origin_city": ""}, {"adults": 0, "seniors": 0, "kids": 2},
                {"start_date": past}, {"origin": "DELHI"}, {"origin": "D3L"}):  # too long: 422; not letters: 400
        assert (await client.patch(f"/my-trips/{trip['code']}", json={**body, **bad})).status_code in (400, 422), bad
    assert (await client.get(f"/my-trips/{trip['code']}")).json()["start_date"] == later


def test_rooms_and_nights_follow_the_party_and_where_they_sleep():
    import datetime as dt

    from app.modules.creators import stay_prices as sp

    assert [r.adults for r in sp.rooms_for(2, 0)] == [2]
    assert [r.adults for r in sp.rooms_for(5, 2)] == [2, 2, 1]
    assert sp.rooms_for(2, 2)[0].child_ages == [sp.ASSUMED_CHILD_AGE] * 2
    start = dt.date(2027, 1, 10)
    one = sp.stay_nights([{"id": "a", "day": 1}], start, 4)
    assert one["a"] == (start, dt.date(2027, 1, 13))  # a 4-day plan: 3 nights
    two = sp.stay_nights([{"id": "b", "day": 3}, {"id": "a", "day": 1}], start, 5)
    assert two["a"] == (start, dt.date(2027, 1, 12)) and two["b"] == (dt.date(2027, 1, 12), dt.date(2027, 1, 14))


def test_every_traveller_is_roomed_and_no_room_breaks_tripjacks_limits():
    from app.modules.creators import stay_prices as sp

    # Two adults and five children: two rooms, all seven in them (the fifth child was once dropped).
    assert [sp.describe(p) for p in sp.room_plans(2, 5)] == [
        ["1 adult + 3 children", "1 adult + 2 children"]
    ]
    groups = [(1, 0), (2, 0), (2, 2), (2, 3), (2, 5), (3, 1), (4, 0), (4, 2), (5, 2), (1, 4), (2, 8), (9, 9)]
    for adults, kids in groups:
        plans = sp.room_plans(adults, kids)
        assert plans, (adults, kids)
        for plan in plans:  # everyone in, a grown-up in every room, never over four children
            assert sum(r.adults for r in plan) == adults and sum(len(r.child_ages) for r in plan) == kids
            assert all(r.adults >= 1 and len(r.child_ages) <= sp.MAX_CHILDREN_PER_ROOM for r in plan)
    # No way to room one grown-up with five children, or children alone: nobody is left out to fit.
    assert sp.room_plans(1, 5) == [] and sp.room_plans(0, 2) == []
    # A family also gets a way with one more room; a couple is never split up to find a room.
    assert len(sp.room_plans(2, 2)) == 2 and len(sp.room_plans(2, 0)) == 1


class FakeHotels:
    configured = True

    def __init__(self):
        self.calls = []

    async def pricing(self, **kw):
        self.calls.append(kw)
        return {"hotelName": "x", "options": [
            {"optionId": "dear", "mealBasis": "Room only", "roomInfo": [{"name": "Deluxe"}],
             "pricing": {"basePrice": 20000, "taxes": 2000, "mf": 0, "mft": 0, "currency": "INR"}},
            {"optionId": "cheap", "mealBasis": "Breakfast", "roomInfo": [{"name": "Standard"}],
             "pricing": {"basePrice": 12000, "taxes": 1200, "mf": 0, "mft": 0, "currency": "INR"}},
        ]}


async def test_a_matched_stay_is_priced_live_for_the_dates_and_party(client, traveler, builds, monkeypatch):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel

    async def none(*a, **k):
        return None

    fake = FakeHotels()
    monkeypatch.setattr(sp, "tripjack_hotels", fake)
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:
        session.add(SupplierHotel(tj_hotel_id="h1", region_id=1, name="Grand Mega Resort & Spa",
                                  hero_image="https://img.example/mega.jpg"))
        await session.commit()
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "kids": 1, "days": 3, "pace": "relaxed", "group": "family", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()

    got = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()
    (stay,) = got["stays"]
    assert stay["status"] == "priced" and stay["hotel"]["id"] == "h1" and stay["nights"] == 2
    assert stay["check_in"] == start.isoformat() and stay["check_out"] == (start + dt.timedelta(days=2)).isoformat()
    assert stay["total"] == 13200 and stay["room"] == "Standard" and got["total"] == 13200  # the cheapest rate
    assert got["all_priced"] and got["rooms"] == 1 and got["children_assumed_age"] == sp.ASSUMED_CHILD_AGE
    assert fake.calls[0]["rooms"] == [{"adults": 2, "children": 1, "childAge": [sp.ASSUMED_CHILD_AGE]}]

    # Taking the date away is refused: a trip board always has one, so its stays are priced.
    r = await client.patch(f"/my-trips/{trip['code']}", json={**body, "start_date": None})
    assert r.status_code == 400 and r.json()["detail"] == "Choose the date you leave."


async def test_a_family_too_big_for_any_room_is_told_so_never_shrunk(client, traveler, builds, monkeypatch):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel

    async def none(*a, **k):
        return None

    fake = FakeHotels()
    monkeypatch.setattr(sp, "tripjack_hotels", fake)
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:
        session.add(SupplierHotel(tj_hotel_id="h1", region_id=1, name="Grand Mega Resort & Spa",
                                  hero_image="https://img.example/mega.jpg"))
        await session.commit()
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "kids": 5, "days": 3, "pace": "relaxed", "group": "family", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    (stay,) = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()["stays"]
    # Two rooms with all seven in them: TripJack is asked for exactly that.
    assert stay["status"] == "priced" and stay["rooms"] == ["1 adult + 3 children", "1 adult + 2 children"]
    sent = fake.calls[0]["rooms"]
    assert sum(r["adults"] + r.get("children", 0) for r in sent) == 7

    # One grown-up with five children fits no room TripJack sells: it says so, and asks nothing.
    fake.calls.clear()
    await client.patch(f"/my-trips/{trip['code']}", json={**body, "adults": 1})
    got = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()
    assert got["stays"][0]["status"] == "no_rooms" and got["rooms"] == 0 and fake.calls == []


def test_a_destination_names_its_airport():
    from app.modules.flights.airports import airport_for

    assert airport_for("Goa") == "GOI" and airport_for("Bali, Indonesia") == "DPS"
    assert airport_for("Hong Kong") == "HKG" and airport_for("Somewhere new") is None


class FakeFlights:
    configured = True

    def __init__(self):
        self.queries = []

    async def search(self, query):
        self.queries.append(query)
        def trip(price, a, b):
            return {"fareIdentifier": "PUBLISHED", "id": f"id{price}", "fd": {"ADULT": {"fC": {"BF": price, "TAF": 100}}}}
        seg = lambda a, b, n: {"da": {"code": a}, "aa": {"code": b}, "dt": "2027-01-10T08:00", "at": "2027-01-10T10:00",
                               "fD": {"aI": {"code": "6E", "name": "IndiGo"}, "fN": n}, "duration": 120, "stops": 0}
        return {"searchResult": {"tripInfos": {
            "ONWARD": [{"sI": [seg("DEL", "GOI", "101")], "totalPriceList": [trip(5000, "DEL", "GOI")]},
                       {"sI": [seg("DEL", "GOI", "102")], "totalPriceList": [trip(7000, "DEL", "GOI")]}],
            "RETURN": [{"sI": [seg("GOI", "DEL", "201")], "totalPriceList": [trip(4000, "GOI", "DEL")]}],
        }}}


async def test_the_return_flight_is_priced_live_or_says_why_not(client, traveler, builds, monkeypatch):
    import datetime as dt

    from app.modules.creators import flight_prices as fp
    from app.modules.flights import service as flights_service

    async def none(*a, **k):
        return None

    fake = FakeFlights()
    monkeypatch.setattr(flights_service, "tripjack_flights", fake)
    monkeypatch.setattr(fp, "tripjack_flights", fake)
    for mod in (fp, flights_service):
        monkeypatch.setattr(mod, "cache_get", none)
        monkeypatch.setattr(mod, "cache_set", none)
    job_id = await _import_for(traveler)  # Bali in the seed; the destination below is Goa
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "kids": 1, "days": 4, "pace": "relaxed", "group": "family", "start_date": start.isoformat(), "origin": "DEL", "origin_city": "Delhi"}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    async with SessionLocal() as session:
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.destination_name = "Goa"
        await session.commit()

    got = (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()
    assert got["status"] == "priced" and (got["origin"], got["destination"]) == ("DEL", "GOI")
    assert [leg["flight_number"] for leg in got["legs"]] == ["6E101", "6E201"]  # the cheapest each way
    assert got["total"] == 2 * (5100 + 4100) and (got["adults"], got["children"]) == (2, 1)
    assert got["legs"][1]["date"] == (start + dt.timedelta(days=3)).isoformat()

    # No from-city or no date is refused: a trip board always has both.
    for change in ({"origin": ""}, {"start_date": None}):
        assert (await client.patch(f"/my-trips/{trip['code']}", json={**body, **change})).status_code == 400
    # Flying to where they live: not priced, and it says why.
    await client.patch(f"/my-trips/{trip['code']}", json={**body, "origin": "GOI"})
    assert (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()["status"] == "same_city"
    async with SessionLocal() as session:
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.destination_name = "Atlantis"
        await session.commit()
    await client.patch(f"/my-trips/{trip['code']}", json=body)
    assert (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()["status"] == "no_airport"


async def test_a_stay_with_no_hotel_keeps_its_name_and_gets_priced_suggestions(
    client, traveler, builds, monkeypatch
):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel

    async def none(*a, **k):
        return None

    fake = FakeHotels()
    monkeypatch.setattr(sp, "tripjack_hotels", fake)
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:
        session.add_all([
            SupplierHotel(tj_hotel_id=f"h{i}", region_id=1, name=name, hero_image="https://img.example/x.jpg")
            for i, name in enumerate(["Mega Palace Hotel", "Grand Mega Resort Kuta", "Mega Beach Inn", "Mega Villas"])
        ])
        await session.commit()
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "days": 3, "pace": "relaxed", "group": "couple", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    async with SessionLocal() as session:  # the reel's stay names a hotel we do not hold
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.items = [{**i, "name": "Mega Beach Lodge"} if i["kind"] == "stay" else i for i in row.items]
        await session.commit()

    before = (await client.get(f"/my-trips/{trip['code']}")).json()["items"]
    got = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()
    (stay,) = got["stays"]
    # Not a hotel we can book: it says so, and offers hotels that have a room, priced live.
    assert stay["status"] == "not_matched" and stay["name"] == "Mega Beach Lodge"
    assert stay["alternatives"] and all(a["total"] == 13200 for a in stay["alternatives"])
    assert stay["alternatives"][0]["rooms"] == ["2 adults"]
    assert not got["all_priced"] and got["total"] == 0  # suggestions are not in the total
    # The price check changed nothing: the trip still stays where the reel said.
    assert (await client.get(f"/my-trips/{trip['code']}")).json()["items"] == before


async def test_a_hotel_with_no_room_is_kept_and_a_hotel_with_one_is_suggested(client, traveler, builds, monkeypatch):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel

    async def none(*a, **k):
        return None

    class SoldOut(FakeHotels):
        async def pricing(self, **kw):
            self.calls.append(kw)
            if kw["hid"] == "h1":
                return {"hotelName": "x", "options": []}  # the reel's own hotel has no room
            return await super().pricing(**kw)

    fake = SoldOut()
    monkeypatch.setattr(sp, "tripjack_hotels", fake)
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:
        session.add_all([
            SupplierHotel(tj_hotel_id="h1", region_id=1, name="Grand Mega Resort & Spa", hero_image="https://img.example/a.jpg"),
            SupplierHotel(tj_hotel_id="h2", region_id=1, name="Grand Mega Resort Kuta", hero_image="https://img.example/b.jpg"),
        ])
        await session.commit()
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "days": 3, "pace": "relaxed", "group": "couple", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()

    async with SessionLocal() as session:  # the stay names a hotel we hold that has no room
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.items = [{**i, "name": "Grand Mega Resort & Spa"} if i["kind"] == "stay" else i for i in row.items]
        await session.commit()
    before = (await client.get(f"/my-trips/{trip['code']}")).json()["items"]
    (stay,) = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()["stays"]
    assert stay["status"] == "unavailable" and stay["hotel"]["id"] == "h1" and stay["total"] is None
    assert stay["name"] == "Grand Mega Resort & Spa"  # the creator's hotel, not replaced
    assert [a["hotel"]["id"] for a in stay["alternatives"]] == ["h2"]  # never h1 again: it is sold out
    assert (await client.get(f"/my-trips/{trip['code']}")).json()["items"] == before


async def test_a_stay_staff_unlinked_is_left_alone_and_no_dates_means_no_swap(client, traveler, builds, monkeypatch):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel

    async def none(*a, **k):
        return None

    fake = FakeHotels()
    monkeypatch.setattr(sp, "tripjack_hotels", fake)
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:
        session.add(SupplierHotel(tj_hotel_id="h9", region_id=1, name="Mega Beach Inn", hero_image="https://img.example/x.jpg"))
        await session.commit()
    job_id = await _import_for(traveler)
    body = {**trip_details(), "adults": 2, "days": 3, "pace": "relaxed", "group": "couple"}  # no start date
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    got = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()
    assert got["stays"][0]["status"] in ("no_dates", "not_matched") and fake.calls == []  # TripJack is not asked


async def test_every_trip_has_travel_a_checkout_and_meals_every_day():
    out = await builder.build(
        FakeAI(good_plan()), must=must(), destination="Bali", days=3, adults=2, kids=0, seniors=0,
        pace="relaxed", when="", group="couple", summary="A Bali trip", origin_city="Bengaluru",
    )  # fmt: skip
    items = out["items"]

    def day(n, kind=None):
        return [i for i in items if i["day"] == n and (kind is None or i["kind"] == kind)]

    # The way in and out, in order, on the first and last day.
    assert [i["name"] for i in day(1, "travel")][:2] == ["Fly Bengaluru to Bali", "Airport to your stay"]
    assert [i["name"] for i in day(3, "travel")][-2:] == ["Your stay to the airport", "Fly back to Bengaluru"]
    assert day(1)[0]["name"] == "Fly Bengaluru to Bali" and day(3)[-1]["name"] == "Fly back to Bengaluru"
    assert next(i for i in day(1, "stay"))["slot"] == "afternoon"  # check-in after landing
    assert any(i["name"] == "Check out" for i in day(3))
    # Every day has its rides between stops, and a middle day has nothing but those.
    assert [i["name"] for i in day(2, "travel")] == [f"Getting around: {', then '.join(i['name'] for i in day(2) if i['kind'] in ('sight', 'experience'))}"]
    # Meals: breakfast is skipped on arrival and dinner on departure; every other mealtime is there.
    slots = lambda n: {i["slot"] for i in day(n, "food")}  # noqa: E731
    assert slots(1) >= {"afternoon", "evening"} and "morning" not in slots(1)
    assert slots(2) == {"morning", "afternoon", "evening"}
    assert slots(3) >= {"morning", "afternoon"} and "evening" not in slots(3)
    # A meal the AI already named is kept, not doubled.
    assert sum(1 for i in day(2, "food") if i["slot"] == "evening") == 1
    assert next(i for i in day(2, "food") if i["name"] == "Locavore")["origin"] == "reel"
    # No prices or times are invented in anything added.
    added = [i for i in items if i["origin"] == "suggested" and i["kind"] in ("travel", "food", "note")]
    assert not any(ch in (i["name"] + i["note"]) for i in added for ch in "₹$")


async def test_the_ai_is_given_where_they_fly_from_and_the_reels_tips():
    ai = FakeAI(good_plan())
    await builder.build(
        ai, must=must(), destination="Bali", days=3, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="A Bali trip", origin_city="Bengaluru",
        reel_tips=["Take a scooter taxi"],
    )  # fmt: skip
    facts = json.loads(ai.sent[0][1]["content"].split("Facts:\n", 1)[1])
    assert facts["travelling_from"] == "Bengaluru" and facts["reel_tips"] == ["Take a scooter taxi"]
    system = ai.sent[0][0]["content"]
    assert "visa" in system and "Name the dish or cuisine" in system and "close together" in system


async def test_a_stay_without_a_hotel_becomes_a_hotel_we_hold_that_fits_the_budget():
    from app.modules.creators import stays
    from app.modules.hotels.models import SupplierHotel, SupplierRegion

    async with SessionLocal() as session:
        session.add(SupplierRegion(region_id=7, city_name="BALI", country_name="INDONESIA", full_name="Bali"))
        for n, (name, stars, rank) in enumerate(
            [("Kuta Backpackers Inn", 2.5, 50), ("Sea View Resort Bali", 4.0, 60), ("Grand Palace Bali", 5.0, 90)]
        ):
            session.add(SupplierHotel(tj_hotel_id=f"s{n}", region_id=7, name=name, star_rating=stars, rank=rank,
                                      hero_image=f"https://img.example/s{n}.jpg", city="Bali", country="Indonesia"))  # fmt: skip
        await session.commit()

        def trip():
            return [
                {"id": "a", "kind": "stay", "name": "Stay in Seminyak", "day": 1, "origin": "suggested", "note": ""},
                {"id": "b", "kind": "sight", "name": "Tanah Lot", "day": 1, "origin": "reel", "note": ""},
            ]

        budget = await stays.name_the_stay(session, trip(), "Bali", "Bali under 50k budget plan")
        assert budget[0]["name"] == "Kuta Backpackers Inn" and budget[0]["origin"] == "suggested"
        assert budget[1]["name"] == "Tanah Lot"  # nothing else is touched
        default = await stays.name_the_stay(session, trip(), "Bali", "A slow Bali trip")
        assert default[0]["name"] == "Sea View Resort Bali"
        luxury = await stays.name_the_stay(session, trip(), "Bali", "luxury 5 star Bali")
        assert luxury[0]["name"] == "Grand Palace Bali"
        # A stay the reel named is the traveller's choice: left as it is. So is one we already hold.
        named = trip()
        named[0].update(origin="reel", name="Some reel hotel")
        assert (await stays.name_the_stay(session, named, "Bali"))[0]["name"] == "Some reel hotel"
        held = trip()
        held[0]["name"] = "Grand Palace Bali"
        assert (await stays.name_the_stay(session, held, "Bali", "budget"))[0]["name"] == "Grand Palace Bali"
        # No hotels for the destination: the stay stays as written.
        assert (await stays.name_the_stay(session, trip(), "Atlantis"))[0]["name"] == "Stay in Seminyak"


async def test_a_plan_with_bare_middle_days_is_asked_again_once_and_the_fuller_one_is_kept():
    bare = good_plan(days=4)
    bare["days"][2]["items"] = [{"name": "Nusa Penida", "kind": "experience", "slot": "morning"}]
    bare["days"][1]["items"] = [{"name": "Tegalalang Rice Terrace", "kind": "sight", "slot": "morning"},
                                {"name": "Locavore", "kind": "food", "slot": "evening"}]  # fmt: skip
    bare["days"].append({"day": 4, "title": "Home", "items": [{"name": "Sunset point", "kind": "sight", "slot": "morning"}]})
    full = json.loads(json.dumps(bare))
    full["days"][1]["items"].append({"name": "Monkey Forest", "kind": "sight", "slot": "afternoon", "optional": True})
    full["days"][2]["items"].append({"name": "Waterfall", "kind": "sight", "slot": "afternoon", "optional": True})

    class TwoAnswers(FakeAI):
        async def complete(self, task, messages, **kwargs):
            self.sent.append(messages)
            return json.dumps(bare if len(self.sent) == 1 else full)

    ai = TwoAnswers(None)
    out = await build(ai, days=4)
    assert len(ai.sent) >= 2 and "has too little to do" in ai.sent[1][-1]["content"]
    assert builder.thin_days(out["items"], 4) == []
    assert {"Monkey Forest", "Waterfall"} <= {i["name"] for i in out["items"]}

    class Stubborn(FakeAI):
        async def complete(self, task, messages, **kwargs):
            self.sent.append(messages)
            return json.dumps(bare)

    again = await build(Stubborn(None), days=4)
    assert again["ai_built"] is True  # the plan is still used; it is not thrown away for being thin


async def test_plain_meals_get_a_dish_and_an_area_and_a_bad_answer_changes_nothing():
    class Meals(FakeAI):
        async def complete(self, task, messages, **kwargs):
            self.sent.append(messages)
            if "what to eat" in messages[0]["content"]:
                return json.dumps({"meals": [
                    {"day": 2, "meal": "lunch", "dish": "Babi guling", "area": "Ubud"},
                    {"day": 1, "meal": "dinner", "dish": "Grilled fish", "area": "Tanah Lot"},
                    {"day": 2, "meal": "breakfast", "dish": "Cheap meal for ₹200", "area": "Ubud"},
                ]})
            return json.dumps(good_plan())

    named = await build(Meals(None))
    day2 = {i["slot"]: i["name"] for i in named["items"] if i["day"] == 2 and i["kind"] == "food"}
    assert day2["afternoon"] == "Lunch: Babi guling in Ubud"
    assert day2["morning"] == "Breakfast"  # a price in the answer is refused, the plain entry stays
    day1 = {i["slot"]: i["name"] for i in named["items"] if i["day"] == 1 and i["kind"] == "food"}
    assert day1["evening"] == "Dinner: Grilled fish"  # an activity given back as the place is dropped
    assert day1["afternoon"] == "Lunch"  # not named by the answer: stays plain

    class Broken(Meals):
        async def complete(self, task, messages, **kwargs):
            if "what to eat" in messages[0]["content"]:
                raise RuntimeError("down")
            return json.dumps(good_plan())

    plain = await build(Broken(None))
    assert plain["ai_built"] is True and any(i["name"] == "Lunch" for i in plain["items"])


async def test_a_trip_always_has_a_stay_and_the_visa_tip_follows_the_trip_being_abroad():
    plan = good_plan()
    plan["days"][0]["items"] = [i for i in plan["days"][0]["items"] if i["kind"] != "stay"]
    ai = FakeAI(plan)
    out = await builder.build(
        ai, must=[m for m in must() if m["kind"] != "stay"], destination="Bali", days=3, adults=2,
        kids=0, seniors=0, pace="relaxed", when="", group="couple", summary="", domestic=False,
    )  # fmt: skip
    stays = [i for i in out["items"] if i["kind"] == "stay"]
    assert [s["name"] for s in stays] == ["Stay in Bali"] and stays[0]["day"] == 1
    facts = json.loads(ai.sent[0][1]["content"].split("Facts:\n", 1)[1])
    assert facts["same_country_trip"] is False
    local = FakeAI(good_plan())
    await builder.build(
        local, must=must(), destination="Goa", days=3, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="", domestic=True,
    )  # fmt: skip
    assert json.loads(local.sent[0][1]["content"].split("Facts:\n", 1)[1])["same_country_trip"] is True
    assert "never mention visas" in local.sent[0][0]["content"]


async def test_a_trip_inside_one_country_is_known_from_tripjacks_cities():
    from app.modules.creators import stays
    from app.modules.hotels.models import SupplierRegion

    async with SessionLocal() as session:
        for rid, city, country in [(1, "GOA", "INDIA"), (2, "MUMBAI", "INDIA"), (3, "BALI", "INDONESIA"),
                                   (4, "BALI", "INDIA")]:  # a Bali in Rajasthan too
            session.add(SupplierRegion(region_id=rid, city_name=city, country_name=country, full_name=city))
        await session.commit()
        assert await stays.same_country(session, "Goa", "Mumbai") is True
        assert await stays.same_country(session, "Bali", "Mumbai") is True  # one of the Balis is Indian
        assert await stays.same_country(session, "Goa", "Nowhere") is None  # not known: not guessed
        assert await stays.same_country(session, "Goa", "") is None


async def test_the_word_optional_is_taken_out_of_a_place_name_because_the_flag_says_it():
    plan = good_plan()
    plan["days"][0]["items"][2]["name"] = "Optional: Beach walk"
    out = await build(FakeAI(plan))
    walk = next(i for i in out["items"] if i["name"] == "Beach walk")
    assert walk["optional"] is True


async def test_a_stay_we_wrote_as_an_area_goes_by_the_trips_budget_not_by_matching_words(
    client, traveler, builds, monkeypatch
):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel, SupplierRegion

    async def none(*a, **k):
        return None

    class Priced(FakeHotels):
        async def pricing(self, **kw):
            self.calls.append(kw)
            base = {"h-villa": 90000, "h-inn": 9000, "h-mid": 20000}[kw["hid"]]
            return {"hotelName": "x", "options": [
                {"optionId": "o", "mealBasis": "Room only", "roomInfo": [{"name": "Room"}],
                 "pricing": {"basePrice": base, "taxes": 0, "mf": 0, "mft": 0, "currency": "INR"}}]}

    monkeypatch.setattr(sp, "tripjack_hotels", Priced())
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:
        session.add(SupplierRegion(region_id=11, city_name="BALI", country_name="INDONESIA", full_name="Bali"))
        for tj, name, stars, rank in [("h-villa", "Downtown Villas", 3.0, 90), ("h-inn", "City Budget Inn", 2.5, 40),
                                      ("h-mid", "Mid Hotel", 3.5, 60)]:
            session.add(SupplierHotel(tj_hotel_id=tj, region_id=11, name=name, star_rating=stars, rank=rank,
                                      hero_image="https://img.example/x.jpg", city="Bali", country="Indonesia"))  # fmt: skip
        await session.commit()
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "days": 3, "pace": "relaxed", "group": "couple", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()

    async def make(summary: str):
        async with SessionLocal() as session:
            row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
            row.summary = summary
            row.items = [{**i, "name": "Stay in Downtown Bali", "origin": "suggested", "was": None}
                         if i["kind"] == "stay" else i for i in row.items]
            await session.commit()
        return (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()["stays"][0]

    budget = await make("A budget plan for Bali")
    first = budget["alternatives"][0]
    assert budget["status"] == "not_matched" and budget["name"] == "Stay in Downtown Bali"
    assert first["hotel"]["name"] == "City Budget Inn" and first["total"] == 9000  # the cheapest first
    # "Downtown" in a hotel's name is no reason to put it first.
    # Not a budget trip: the middle rate of the right class comes first, not the villa.
    again = await make("A slow trip around Bali")
    assert again["alternatives"][0]["hotel"]["name"] == "Mid Hotel"


async def test_with_no_hotels_held_for_the_destination_the_stay_comes_from_a_live_search(
    client, traveler, builds, monkeypatch
):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel

    async def none(*a, **k):
        return None

    asked = []

    async def search(session, q):
        asked.append(q)
        card = lambda tj, name, stars, total, rank: {  # noqa: E731
            "hotel_id": tj, "name": name, "stars": stars, "rank": rank,
            "option": {"price": {"total": total}},
        }
        return {"region": {"region_id": 99},
                "hotels": [card("s-villa", "Palace Villas", "5.0", 90000, 90),
                           card("s-far", "Far Away Hostel", "2.5", 5000, 10),  # a hotel of another city
                           card("s-dorm", "Backpackers Hostel", "2.5", 4000, 5),  # cheapest, but a hostel
                           card("s-inn", "City Budget Inn", "3.0", 9000, 20),
                           card("s-mid", "Mid Hotel", "3.5", 20000, 60)]}

    class Priced(FakeHotels):
        async def pricing(self, **kw):
            self.calls.append(kw)
            return {"hotelName": "x", "options": [{"optionId": "o", "mealBasis": "Room only", "roomInfo": [{"name": "Room"}],
                    "pricing": {"basePrice": 9000, "taxes": 0, "mf": 0, "mft": 0, "currency": "INR"}}]}

    monkeypatch.setattr(sp.hotel_search, "search", search)
    monkeypatch.setattr(sp, "tripjack_hotels", Priced())
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:  # content rows for the hotels the search names; no region
        for tj, name in [("s-villa", "Palace Villas"), ("s-inn", "City Budget Inn"), ("s-mid", "Mid Hotel")]:
            session.add(SupplierHotel(tj_hotel_id=tj, region_id=99, name=name, hero_image="https://img.example/x.jpg"))
        session.add(SupplierHotel(tj_hotel_id="s-far", region_id=555, name="Far Away Hostel",
                                  hero_image="https://img.example/x.jpg"))
        session.add(SupplierHotel(tj_hotel_id="s-dorm", region_id=99, name="Backpackers Hostel",
                                  hero_image="https://img.example/x.jpg"))
        await session.commit()
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "days": 3, "pace": "relaxed", "group": "couple", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    async with SessionLocal() as session:
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.summary = "A budget plan"
        row.items = [{**i, "name": "Stay in Bali", "origin": "suggested"} if i["kind"] == "stay" else i for i in row.items]
        await session.commit()

    (stay,) = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()["stays"]
    assert asked and asked[0].city == "Bali" and asked[0].check_in == start
    # The cheapest card is another city's hostel, so it is ignored; the cheapest of this one is offered.
    assert stay["status"] == "not_matched" and stay["name"] == "Stay in Bali"
    assert stay["alternatives"][0]["hotel"]["name"] == "City Budget Inn"


def test_a_bed_in_a_dormitory_is_never_the_price_of_a_stay():
    from app.modules.creators import stay_prices as sp

    def option(price, room):
        return {"price": {"total": price}, "rooms": [{"name": room}]}

    rates = [option(4000, "Bed in 8-Bed Mixed Dormitory"), option(5000, "Luxury Shared Dormitory"),
             option(9000, "Double Room"), option(12000, "Suite")]
    assert sp._cheapest(rates)["price"]["total"] == 9000  # the cheapest room of your own
    assert sp._cheapest(rates[:2]) is None  # only shared beds: no room for a couple
    assert sp._cheapest([]) is None


async def test_a_trip_through_several_towns_sleeps_in_each_and_travels_between_them():
    items = [
        {**p, "id": f"x{i}", "origin": "reel", "note": "", "location_id": None, "verified": False}
        for i, p in enumerate([
            {"name": "Bagdogra Airport", "kind": "area", "video_day": 1},
            {"name": "Phuentsholing", "kind": "area", "video_day": 1},
            {"name": "Thimphu", "kind": "area", "video_day": 2},
            {"name": "Paro", "kind": "area", "video_day": 4},
            {"name": "Buddha Dordenma", "kind": "sight", "video_day": 3},
            {"name": "Tiger's Nest", "kind": "sight", "video_day": 4},
        ])
    ]
    route = builder.route_from(items)
    assert [(r["name"], r["day"], r["airport"]) for r in route] == [
        ("Bagdogra Airport", 1, True), ("Phuentsholing", 1, False), ("Thimphu", 2, False), ("Paro", 4, False)]
    stops = [i for i in items if i["kind"] != "area"]
    plan = {"summary": "", "tips": [], "days": [
        {"day": d, "items": [{"name": i["name"], "kind": "sight", "slot": "morning"} for i in stops if i["video_day"] == d]
         or [{"name": "Walk", "kind": "sight", "slot": "morning"}]} for d in range(1, 5)]}
    out = await builder.build(
        FakeAI(plan), must=stops, destination="Bhutan", days=4, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="", origin_city="Bengaluru", route=route,
    )  # fmt: skip
    got = out["items"]
    by = lambda kind: [(i["day"], i["name"]) for i in got if i["kind"] == kind]  # noqa: E731
    assert by("stay") == [(1, "Stay in Phuentsholing"), (2, "Stay in Thimphu"), (4, "Stay in Paro")]
    names = [n for _, n in by("travel")]
    assert "Fly Bengaluru to Bagdogra Airport" in names and "Bagdogra Airport to Phuentsholing" in names
    assert (2, "Travel from Phuentsholing to Thimphu") in by("travel")
    assert (4, "Travel from Thimphu to Paro") in by("travel")
    assert next(i for i in got if i["name"] == "Buddha Dordenma")["day"] == 3  # the video's day
    assert next(i for i in got if i["name"] == "Tiger's Nest")["day"] == 4
    for d in range(1, 5):  # every day has a stay to come back to, food, and a way to get about
        assert any(i["day"] == d and i["kind"] == "travel" for i in got)
        assert any(i["day"] == d and i["kind"] == "food" for i in got)


async def test_a_model_journey_is_kept_once_as_travel_and_its_airport_and_checkout_lines_are_dropped():
    plan = good_plan()
    plan["days"][1]["items"] += [
        {"name": "Travel from Kuta to Ubud", "kind": "note", "slot": "afternoon", "note": "scenic drive"},
        {"name": "Transfer to Paro International Airport", "kind": "note", "slot": "morning"},
        {"name": "Hotel check-out", "kind": "note", "slot": "morning"},
        {"name": "Fly home", "kind": "travel", "slot": "evening"},
    ]
    out = await builder.build(
        FakeAI(plan), must=must(), destination="Bali", days=3, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="", origin_city="Mumbai",
        route=[{"name": "Kuta", "day": 1, "airport": False}, {"name": "Ubud", "day": 2, "airport": False}],
    )  # fmt: skip
    got = [(i["day"], i["kind"], i["name"]) for i in out["items"]]
    assert got.count((2, "travel", "Travel from Kuta to Ubud")) == 1  # the model's, once, not doubled
    assert not any("Paro International" in n or n == "Hotel check-out" for _, _, n in got)
    assert [n for d, k, n in got if k == "travel" and "Fly" in n] == ["Fly Mumbai to Bali", "Fly back to Mumbai"]


async def test_meals_are_asked_for_in_the_town_where_they_sleep_that_day():
    seen = []

    class Spy(FakeAI):
        async def complete(self, task, messages, **kwargs):
            self.sent.append(messages)
            if "what to eat" in messages[0]["content"]:
                seen.append(json.loads(messages[1]["content"])["meals"])
                return json.dumps({"meals": []})
            return json.dumps(good_plan())

    await builder.build(
        Spy(None), must=must(), destination="Bhutan", days=3, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="",
        route=[{"name": "Phuentsholing", "day": 1, "airport": False}, {"name": "Thimphu", "day": 2, "airport": False}],
    )  # fmt: skip
    towns = {(m["day"], m["town"]) for m in seen[0]}
    assert (1, "Phuentsholing") in towns and (2, "Thimphu") in towns and (3, "Thimphu") in towns


async def test_each_town_of_a_trip_is_searched_for_its_own_stay(
    client, traveler, builds, monkeypatch
):
    import datetime as dt

    from app.modules.creators import stay_prices as sp
    from app.modules.hotels.models import SupplierHotel

    async def none(*a, **k):
        return None

    asked = []

    async def search(session, q):
        asked.append(q)
        card = lambda tj, name, stars, total, rank: {  # noqa: E731
            "hotel_id": tj, "name": name, "stars": stars, "rank": rank,
            "option": {"price": {"total": total}},
        }
        return {"region": {"region_id": 99},
                "hotels": [card("s-villa", "Palace Villas", "5.0", 90000, 90),
                           card("s-far", "Far Away Hostel", "2.5", 5000, 10),  # a hotel of another city
                           card("s-dorm", "Backpackers Hostel", "2.5", 4000, 5),  # cheapest, but a hostel
                           card("s-inn", "City Budget Inn", "3.0", 9000, 20),
                           card("s-mid", "Mid Hotel", "3.5", 20000, 60)]}

    class Priced(FakeHotels):
        async def pricing(self, **kw):
            self.calls.append(kw)
            return {"hotelName": "x", "options": [{"optionId": "o", "mealBasis": "Room only", "roomInfo": [{"name": "Room"}],
                    "pricing": {"basePrice": 9000, "taxes": 0, "mf": 0, "mft": 0, "currency": "INR"}}]}

    monkeypatch.setattr(sp.hotel_search, "search", search)
    monkeypatch.setattr(sp, "tripjack_hotels", Priced())
    monkeypatch.setattr(sp, "cache_get", none)
    monkeypatch.setattr(sp, "cache_set", none)
    async with SessionLocal() as session:  # content rows for the hotels the search names; no region
        for tj, name in [("s-villa", "Palace Villas"), ("s-inn", "City Budget Inn"), ("s-mid", "Mid Hotel")]:
            session.add(SupplierHotel(tj_hotel_id=tj, region_id=99, name=name, hero_image="https://img.example/x.jpg"))
        session.add(SupplierHotel(tj_hotel_id="s-far", region_id=555, name="Far Away Hostel",
                                  hero_image="https://img.example/x.jpg"))
        session.add(SupplierHotel(tj_hotel_id="s-dorm", region_id=99, name="Backpackers Hostel",
                                  hero_image="https://img.example/x.jpg"))
        await session.commit()
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "days": 3, "pace": "relaxed", "group": "couple", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    async with SessionLocal() as session:
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.summary = "A budget plan"
        row.items = [{**i, "name": "Stay in Thimphu", "origin": "suggested"} if i["kind"] == "stay" else i for i in row.items]
        await session.commit()

    (stay,) = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()["stays"]
    assert asked and asked[0].city == "Thimphu" and asked[0].check_in == start
    # The cheapest card is another city's hostel, so it is ignored; the cheapest of this one is offered.
    assert stay["status"] == "not_matched" and stay["alternatives"][0]["hotel"]["name"] == "City Budget Inn"


def test_a_bed_in_a_dormitory_is_never_the_price_of_a_stay():
    from app.modules.creators import stay_prices as sp

    def option(price, room):
        return {"price": {"total": price}, "rooms": [{"name": room}]}

    rates = [option(4000, "Bed in 8-Bed Mixed Dormitory"), option(5000, "Luxury Shared Dormitory"),
             option(9000, "Double Room"), option(12000, "Suite")]
    assert sp._cheapest(rates)["price"]["total"] == 9000  # the cheapest room of your own
    assert sp._cheapest(rates[:2]) is None  # only shared beds: no room for a couple
    assert sp._cheapest([]) is None


async def test_a_trip_through_several_towns_sleeps_in_each_and_travels_between_them():
    items = [
        {**p, "id": f"x{i}", "origin": "reel", "note": "", "location_id": None, "verified": False}
        for i, p in enumerate([
            {"name": "Bagdogra Airport", "kind": "area", "video_day": 1},
            {"name": "Phuentsholing", "kind": "area", "video_day": 1},
            {"name": "Thimphu", "kind": "area", "video_day": 2},
            {"name": "Paro", "kind": "area", "video_day": 4},
            {"name": "Buddha Dordenma", "kind": "sight", "video_day": 3},
            {"name": "Tiger's Nest", "kind": "sight", "video_day": 4},
        ])
    ]
    route = builder.route_from(items)
    assert [(r["name"], r["day"], r["airport"]) for r in route] == [
        ("Bagdogra Airport", 1, True), ("Phuentsholing", 1, False), ("Thimphu", 2, False), ("Paro", 4, False)]
    stops = [i for i in items if i["kind"] != "area"]
    plan = {"summary": "", "tips": [], "days": [
        {"day": d, "items": [{"name": i["name"], "kind": "sight", "slot": "morning"} for i in stops if i["video_day"] == d]
         or [{"name": "Walk", "kind": "sight", "slot": "morning"}]} for d in range(1, 5)]}
    out = await builder.build(
        FakeAI(plan), must=stops, destination="Bhutan", days=4, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="", origin_city="Bengaluru", route=route,
    )  # fmt: skip
    got = out["items"]
    by = lambda kind: [(i["day"], i["name"]) for i in got if i["kind"] == kind]  # noqa: E731
    assert by("stay") == [(1, "Stay in Phuentsholing"), (2, "Stay in Thimphu"), (4, "Stay in Paro")]
    names = [n for _, n in by("travel")]
    assert "Fly Bengaluru to Bagdogra Airport" in names and "Bagdogra Airport to Phuentsholing" in names
    assert (2, "Travel from Phuentsholing to Thimphu") in by("travel")
    assert (4, "Travel from Thimphu to Paro") in by("travel")
    assert next(i for i in got if i["name"] == "Buddha Dordenma")["day"] == 3  # the video's day
    assert next(i for i in got if i["name"] == "Tiger's Nest")["day"] == 4
    for d in range(1, 5):  # every day has a stay to come back to, food, and a way to get about
        assert any(i["day"] == d and i["kind"] == "travel" for i in got)
        assert any(i["day"] == d and i["kind"] == "food" for i in got)


async def test_a_model_journey_is_kept_once_as_travel_and_its_airport_and_checkout_lines_are_dropped():
    plan = good_plan()
    plan["days"][1]["items"] += [
        {"name": "Travel from Kuta to Ubud", "kind": "note", "slot": "afternoon", "note": "scenic drive"},
        {"name": "Transfer to Paro International Airport", "kind": "note", "slot": "morning"},
        {"name": "Hotel check-out", "kind": "note", "slot": "morning"},
        {"name": "Fly home", "kind": "travel", "slot": "evening"},
    ]
    out = await builder.build(
        FakeAI(plan), must=must(), destination="Bali", days=3, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="", origin_city="Mumbai",
        route=[{"name": "Kuta", "day": 1, "airport": False}, {"name": "Ubud", "day": 2, "airport": False}],
    )  # fmt: skip
    got = [(i["day"], i["kind"], i["name"]) for i in out["items"]]
    assert got.count((2, "travel", "Travel from Kuta to Ubud")) == 1  # the model's, once, not doubled
    assert not any("Paro International" in n or n == "Hotel check-out" for _, _, n in got)
    assert [n for d, k, n in got if k == "travel" and "Fly" in n] == ["Fly Mumbai to Bali", "Fly back to Mumbai"]


async def test_meals_are_asked_for_in_the_town_where_they_sleep_that_day():
    seen = []

    class Spy(FakeAI):
        async def complete(self, task, messages, **kwargs):
            self.sent.append(messages)
            if "what to eat" in messages[0]["content"]:
                seen.append(json.loads(messages[1]["content"])["meals"])
                return json.dumps({"meals": []})
            return json.dumps(good_plan())

    await builder.build(
        Spy(None), must=must(), destination="Bhutan", days=3, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="",
        route=[{"name": "Phuentsholing", "day": 1, "airport": False}, {"name": "Thimphu", "day": 2, "airport": False}],
    )  # fmt: skip
    towns = {(m["day"], m["town"]) for m in seen[0]}
    assert (1, "Phuentsholing") in towns and (2, "Thimphu") in towns and (3, "Thimphu") in towns


async def test_a_trip_that_flies_into_one_airport_and_out_of_another_is_priced_as_two_fares(
    client, traveler, builds, monkeypatch
):
    import datetime as dt

    from app.modules.creators import flight_prices as fp
    from app.modules.flights import service as flights_service

    async def none(*a, **k):
        return None

    PRICES = {("BLR", "IXB"): 3000, ("PBH", "BLR"): 6000, ("IXB", "BLR"): 6000}

    class OpenJaw(FakeFlights):
        async def search(self, query):
            self.queries.append(query)
            route = query["routeInfos"][0]
            origin, destination = route["fromCityOrAirport"]["code"], route["toCityOrAirport"]["code"]
            seg = {"da": {"code": origin}, "aa": {"code": destination}, "dt": "2027-01-10T08:00",
                   "at": "2027-01-10T10:00", "fD": {"aI": {"code": "AI", "name": "Air India"}, "fN": "1"},
                   "duration": 120, "stops": 0}  # fmt: skip
            price = PRICES[(origin, destination)]
            fare = {"fareIdentifier": "PUBLISHED", "id": f"id{price}", "fd": {"ADULT": {"fC": {"BF": price, "TAF": 0}}}}
            trips = {"ONWARD": [{"sI": [seg], "totalPriceList": [fare]}]}
            if len(query["routeInfos"]) == 2:  # a return search: the way back too
                back = query["routeInfos"][1]
                o2, d2 = back["fromCityOrAirport"]["code"], back["toCityOrAirport"]["code"]
                seg2 = {**seg, "da": {"code": o2}, "aa": {"code": d2}}
                fare2 = {**fare, "id": "back", "fd": {"ADULT": {"fC": {"BF": PRICES[(o2, d2)], "TAF": 0}}}}
                trips["RETURN"] = [{"sI": [seg2], "totalPriceList": [fare2]}]
            return {"searchResult": {"tripInfos": trips}}

    fake = OpenJaw()
    monkeypatch.setattr(flights_service, "tripjack_flights", fake)
    monkeypatch.setattr(fp, "tripjack_flights", fake)
    for mod in (fp, flights_service):
        monkeypatch.setattr(mod, "cache_get", none)
        monkeypatch.setattr(mod, "cache_set", none)
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "days": 4, "pace": "relaxed", "group": "couple", "start_date": start.isoformat(),
            "origin": "BLR", "origin_city": "Bengaluru"}  # fmt: skip
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    async with SessionLocal() as session:  # the video flies to Bagdogra, tours Bhutan, and ends in Paro
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.destination_name = "Bhutan"
        row.source_items = [
            *row.source_items,
            {"id": "a1", "kind": "area", "name": "Bagdogra Airport", "video_day": 1, "origin": "reel"},
            {"id": "a2", "kind": "area", "name": "Thimphu", "video_day": 2, "origin": "reel"},
            {"id": "a3", "kind": "area", "name": "Paro", "video_day": 4, "origin": "reel"},
        ]
        await session.commit()

    got = (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()
    assert got["status"] == "priced" and got["destination"] == "IXB"
    assert [(leg["from_code"], leg["to_code"]) for leg in got["legs"]] in (
        [("BLR", "IXB"), ("PBH", "BLR")], [("BLR", "IXB"), ("IXB", "BLR")]
    )
    assert got["total"] == 2 * (3000 + 6000)
    asked = [(q["routeInfos"][0]["fromCityOrAirport"]["code"], q["routeInfos"][0]["toCityOrAirport"]["code"])
             for q in fake.queries]  # fmt: skip
    assert ("BLR", "IXB") in asked and ("PBH", "BLR") in asked  # both ways home were priced

    # Flying home from Paro is dearer than flying back from where they landed: the cheaper is used.
    PRICES[("PBH", "BLR")] = 40000
    cheaper = (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()
    assert cheaper["total"] == 2 * (3000 + 6000)
    assert [(leg["from_code"], leg["to_code"]) for leg in cheaper["legs"]] == [("BLR", "IXB"), ("IXB", "BLR")]



async def test_a_city_spelt_a_little_differently_still_finds_its_tripjack_region():
    from app.modules.hotels import service as hotel_service
    from app.modules.hotels.models import SupplierRegion
    from app.modules.hotels.schemas import HotelSearch

    async with SessionLocal() as session:
        session.add(SupplierRegion(region_id=622618, city_name="PHUNTSHOLING", country_name="BHUTAN", full_name="x"))
        session.add(SupplierRegion(region_id=18172, city_name="THIMPHU", country_name="BHUTAN", full_name="x"))
        await session.commit()
        start = __import__("datetime").date.today() + __import__("datetime").timedelta(days=30)
        q = lambda city: HotelSearch(city=city, check_in=start, check_out=start + __import__("datetime").timedelta(days=1))  # noqa: E731
        assert (await hotel_service.resolve_region(session, q("Phuentsholing"))).region_id == 622618
        assert (await hotel_service.resolve_region(session, q("Thimphu"))).region_id == 18172  # exact first
        with pytest.raises(hotel_service.NoDestination):
            await hotel_service.resolve_region(session, q("Atlantis"))


async def test_a_region_with_no_airport_flies_into_its_first_town_and_home_from_its_last(
    client, traveler, builds, monkeypatch
):
    import datetime as dt

    from app.modules.creators import flight_prices as fp
    from app.modules.flights import service as flights_service

    async def none(*a, **k):
        return None

    PRICES = {("BLR", "PNQ"): 3000, ("BOM", "BLR"): 4000, ("PNQ", "BLR"): 5000}

    class Fares(FakeFlights):
        async def search(self, query):
            self.queries.append(query)
            route = query["routeInfos"][0]
            origin, destination = route["fromCityOrAirport"]["code"], route["toCityOrAirport"]["code"]
            seg = {"da": {"code": origin}, "aa": {"code": destination}, "dt": "2027-01-10T08:00",
                   "at": "2027-01-10T10:00", "fD": {"aI": {"code": "AI", "name": "Air India"}, "fN": "1"},
                   "duration": 120, "stops": 0}  # fmt: skip
            fare = {"fareIdentifier": "PUBLISHED", "id": "f", "fd": {"ADULT": {"fC": {"BF": PRICES[(origin, destination)], "TAF": 0}}}}
            trips = {"ONWARD": [{"sI": [seg], "totalPriceList": [fare]}]}
            if len(query["routeInfos"]) == 2:
                back = query["routeInfos"][1]
                o2, d2 = back["fromCityOrAirport"]["code"], back["toCityOrAirport"]["code"]
                fare2 = {**fare, "id": "b", "fd": {"ADULT": {"fC": {"BF": PRICES[(o2, d2)], "TAF": 0}}}}
                trips["RETURN"] = [{"sI": [{**seg, "da": {"code": o2}, "aa": {"code": d2}}], "totalPriceList": [fare2]}]
            return {"searchResult": {"tripInfos": trips}}

    fake = Fares()
    monkeypatch.setattr(flights_service, "tripjack_flights", fake)
    monkeypatch.setattr(fp, "tripjack_flights", fake)
    for mod in (fp, flights_service):
        monkeypatch.setattr(mod, "cache_get", none)
        monkeypatch.setattr(mod, "cache_set", none)
    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=30)
    body = {**trip_details(), "adults": 2, "days": 8, "pace": "relaxed", "group": "couple", "start_date": start.isoformat(),
            "origin": "BLR", "origin_city": "Bengaluru"}  # fmt: skip
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    async with SessionLocal() as session:  # a Maharashtra road trip: Pune, the hills, then Mumbai
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.destination_name = "Maharashtra"
        row.source_items = [
            *row.source_items,
            {"id": "a1", "kind": "area", "name": "Pune", "video_day": 1, "origin": "reel"},
            {"id": "a2", "kind": "area", "name": "Lonavala", "video_day": 4, "origin": "reel"},
            {"id": "a3", "kind": "area", "name": "Mumbai", "video_day": 7, "origin": "reel"},
            {"id": "a4", "kind": "area", "name": "Malshej Ghat", "video_day": 8, "origin": "reel"},
        ]
        await session.commit()

    got = (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()
    assert got["status"] == "priced" and got["destination"] == "PNQ"
    # Into Pune, home from Mumbai (the last town with an airport): cheaper than back from Pune.
    assert [(leg["from_code"], leg["to_code"]) for leg in got["legs"]] == [("BLR", "PNQ"), ("BOM", "BLR")]
    assert got["total"] == 2 * (3000 + 4000)


async def test_a_day_through_several_towns_sleeps_once_in_the_last_of_them():
    # The Maharashtra reel: day 1 names six towns ("start from Pune or Mumbai ... stay overnight in
    # Tamhini or Kolad"); nobody sleeps in six places in one night.
    items = [
        {**p, "id": f"m{i}", "origin": "reel", "note": "", "location_id": None, "verified": False}
        for i, p in enumerate([
            {"name": "Pune", "kind": "area", "video_day": 1},
            {"name": "Mumbai", "kind": "area", "video_day": 1},
            {"name": "Mulshi", "kind": "area", "video_day": 1},
            {"name": "Kolad", "kind": "area", "video_day": 1},
            {"name": "Lonavala", "kind": "area", "video_day": 3},
            {"name": "Della Resort", "kind": "stay", "video_day": 4},
            {"name": "Devkund Waterfall", "kind": "sight", "video_day": 2},
            {"name": "Korigad Fort", "kind": "sight", "video_day": 3},
        ])
    ]
    route = builder.route_from(items)
    stops = [i for i in items if i["kind"] != "area"]
    plan = {"summary": "", "tips": [], "days": [
        {"day": d, "items": [{"name": i["name"], "kind": "sight", "slot": "morning"} for i in stops if i["video_day"] == d]
         or [{"name": "Walk", "kind": "sight", "slot": "morning"}]} for d in range(1, 5)]}
    out = await builder.build(
        FakeAI(plan), must=stops, destination="Maharashtra", days=4, adults=2, kids=0, seniors=0,
        pace="relaxed", when="", group="couple", summary="", origin_city="Bengaluru", route=route,
    )  # fmt: skip
    got = out["items"]
    stays = [(i["day"], i["name"]) for i in got if i["kind"] == "stay"]
    assert stays == [(1, "Stay in Kolad"), (3, "Stay in Lonavala"), (4, "Della Resort")]
    della = next(i for i in got if i["name"] == "Della Resort")
    assert della["town"] == "Lonavala"  # the creator's hotel is searched for where they are
    travel = [(i["day"], i["name"]) for i in got if i["kind"] == "travel"]
    assert (1, "Travel from Pune to Kolad via Mumbai and Mulshi") in travel
    assert (3, "Travel from Kolad to Lonavala") in travel
    assert (1, "Fly Bengaluru to Pune") in travel  # a region is not where the plane lands


def test_one_stay_a_night_keeps_the_creators_hotel_and_its_town():
    def stay(name, day, origin="suggested"):
        return {"kind": "stay", "name": name, "day": day, "origin": origin}

    items = [stay("Stay in Lonavala", 4), stay("Della Resort", 4, origin="reel"),
             stay("Stay in Pune", 1), stay("Stay in Kolad", 1), stay("Stay in Matheran", 7)]  # fmt: skip
    kept = builder.one_stay_a_night(items)
    assert [(s["day"], s["name"]) for s in kept] == [
        (4, "Della Resort"), (1, "Stay in Kolad"), (7, "Stay in Matheran")
    ]
    assert kept[0]["town"] == "Lonavala"  # meals and the hotel search still look in Lonavala


async def test_a_trip_through_several_towns_gets_a_hotel_in_each_towns_own_town_or_none():
    from app.modules.creators import stays
    from app.modules.hotels.models import SupplierHotel, SupplierRegion

    async with SessionLocal() as session:
        for rid, city in ((81, "KOLAD"), (82, "LONAVALA"), (83, "PUNE")):
            session.add(SupplierRegion(region_id=rid, city_name=city, country_name="INDIA", full_name=city))
        for n, (rid, name) in enumerate([(81, "Riverside Retreat"), (82, "Lakeview Inn"),
                                         (83, "Hotel Great Maratha")]):
            session.add(SupplierHotel(tj_hotel_id=f"m{n}", region_id=rid, name=name, star_rating=4.0, rank=50 + n,
                                      hero_image=f"https://img.example/m{n}.jpg", country="India"))  # fmt: skip
        await session.commit()
        trip = [
            {"id": "a", "kind": "stay", "name": "Stay in Kolad", "day": 1, "origin": "suggested", "note": ""},
            {"id": "b", "kind": "stay", "name": "Stay in Lonavala", "day": 4, "origin": "suggested", "note": ""},
            {"id": "c", "kind": "stay", "name": "Stay in Malshej Ghat", "day": 8, "origin": "suggested", "note": ""},
        ]
        got = await stays.name_the_stay(session, trip, "Maharashtra")
    assert [(i["name"], i.get("town")) for i in got] == [
        ("Riverside Retreat", "Kolad"),
        ("Lakeview Inn", "Lonavala"),
        # No hotel we hold in Malshej Ghat: left for the trip page to find one there, never a
        # hotel from another town (it once got the same Pune hotel as every other night).
        ("Stay in Malshej Ghat", None),
    ]


async def test_a_trip_from_a_creators_video_adds_no_places_or_meals_of_its_own():
    ai = FakeAI(good_plan())  # the planner adds a "Beach walk" the video never named
    out = await builder.build(
        ai, must=must(), destination="Bali", days=3, adults=2, kids=0, seniors=0, pace="relaxed",
        when="", group="couple", summary="", origin_city="Bengaluru", reel_only=True,
    )  # fmt: skip
    items = out["items"]
    added = [i for i in items if i["origin"] != "reel"]
    # Nothing to see, do or eat that the video did not name: no lunch spot, no filler sight.
    assert not [i for i in added if i["kind"] in ("sight", "experience", "food", "area")]
    assert "Beach walk" not in [i["name"] for i in items]
    # The video's own places are all there, its restaurant included.
    assert {i["name"] for i in items if i["origin"] == "reel"} >= {p["name"] for p in must() if p["kind"] != "stay"}
    # The journey is still planned: flights, the transfer, check-out and the stay.
    names = [i["name"] for i in items]
    assert "Fly Bengaluru to Bali" in names and "Fly back to Bengaluru" in names and "Check out" in names
    assert any(i["kind"] == "stay" for i in items)
    # The planner was told so, and not asked to fill light days.
    assert "This trip follows a creator's video" in ai.sent[0][0]["content"] and len(ai.sent) == 1


def test_a_day_reads_in_the_order_it_is_lived():
    def item(name, kind, slot=None, day=2):
        return {"name": name, "kind": kind, "slot": slot, "day": day}

    # Saved in the wrong order (lunch last, the chat's stops without a time of day).
    first_day = [
        item("Dubai Mall", "sight", "afternoon", 1), item("The Dubai Fountain", "sight", "evening", 1),
        item("The Cheesecake Factory", "food", "evening", 1), item("Burj Khalifa", "sight", "afternoon", 1),
        item("Lunch: Emirati machboos in Downtown Dubai", "food", "afternoon", 1),
        item("Stay in Downtown Dubai", "stay", "afternoon", 1), item("Airport to your stay", "travel", "afternoon", 1),
        item("Fly Bengaluru to Dubai", "travel", "morning", 1),
    ]  # fmt: skip
    assert [i["name"] for i in builder.in_day_order(first_day)] == [
        "Fly Bengaluru to Dubai", "Airport to your stay", "Stay in Downtown Dubai",
        "Lunch: Emirati machboos in Downtown Dubai", "Dubai Mall", "Burj Khalifa",
        "The Dubai Fountain", "The Cheesecake Factory",
    ]  # fmt: skip
    last_day = [
        item("Fly back to Bengaluru", "travel", "evening", 3), item("Lunch: Shawarma", "food", "afternoon", 3),
        item("Your stay to the airport", "travel", "afternoon", 3), item("Gold Souk", "sight", "morning", 3),
        item("Check out", "note", "morning", 3), item("Breakfast: Chebab", "food", "morning", 3),
    ]  # fmt: skip
    assert [i["name"] for i in builder.in_day_order(last_day)] == [
        "Breakfast: Chebab", "Check out", "Gold Souk", "Lunch: Shawarma",
        "Your stay to the airport", "Fly back to Bengaluru",
    ]  # fmt: skip


async def test_a_saved_board_is_shown_in_order_without_chat_placeholders(client, traveler, builds):
    from app.modules.creators import mine as mine_module

    job_id = await _import_for(traveler)
    body = {**trip_details(), "adults": 2, "days": 2, "pace": "relaxed", "group": "couple"}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()
    async with SessionLocal() as session:  # a board the chat once rearranged, placeholders and all
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.items = [
            {"id": "a", "kind": "sight", "name": "Dubai Mall", "day": 1, "slot": "afternoon", "origin": "reel"},
            {"id": "b", "kind": "sight", "name": "Sample flight option", "day": 1, "slot": None, "origin": "suggested"},
            {"id": "c", "kind": "food", "name": "Lunch: Machboos", "day": 1, "slot": "afternoon", "origin": "suggested"},
            {"id": "d", "kind": "stay", "name": "Sample hotel option", "day": 1, "slot": None, "origin": "suggested"},
        ]  # fmt: skip
        await session.commit()
        saved = list(row.items)
    board = (await client.get(f"/my-trips/{trip['code']}")).json()
    assert [i["name"] for i in board["items"]] == ["Lunch: Machboos", "Dubai Mall"]
    async with SessionLocal() as session:  # shown so, not saved so: reading never changes a trip
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        assert row.items == saved
    assert mine_module.PLACEHOLDER.match("Sample hotel option")


def test_the_budget_and_notes_from_the_details_screen_reach_the_planner():
    import datetime as dt

    import pytest
    from fastapi import HTTPException

    from app.modules.creators import builder, mine
    from app.modules.creators.models import TravellerTrip

    facts = builder.facts(
        destination="Goa", days=3, adults=2, kids=0, seniors=1, pace="relaxed", when="",
        group="family", for_persona="family", summary="", must=[],
        budget=mine.BUDGETS["under_40k"], notes="Mum can't walk far",
    )  # fmt: skip
    assert facts["budget"].startswith("under ₹40,000") and "no costs" in facts["budget"]
    assert facts["traveller_notes"] == "Mum can't walk far"
    assert builder.facts(
        destination="Goa", days=3, adults=2, kids=0, seniors=0, pace="relaxed", when="",
        group="couple", for_persona="couple", summary="", must=[],
    )["budget"].startswith("not given")  # fmt: skip

    leave = dt.date.today() + dt.timedelta(days=30)
    config = mine.MineConfig(adults=2, days=3, start_date=leave, origin="DEL", budget="cheap")
    with pytest.raises(HTTPException):
        mine._check(config)
    trip = TravellerTrip(adults=2, kids=0, seniors=0, days=3, pace="relaxed", group="couple",
                         budget="", notes="")  # fmt: skip
    config = mine.MineConfig(adults=2, days=3, start_date=leave, origin="DEL", group="couple",
                             budget="40k_60k", notes="  We love  seafood ")  # fmt: skip
    mine._check(config)
    assert mine._apply(trip, config)  # a new budget or note plans the trip again
    assert (trip.budget, trip.notes) == ("40k_60k", "We love seafood")
    assert not mine._apply(trip, config)
