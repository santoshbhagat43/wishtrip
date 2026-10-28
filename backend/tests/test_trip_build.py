"""Building a trip for a party: the planning rules for each kind of group, the checks on what the
AI returns, the fallback without it, and the Details -> Build my trip flow."""

import json

import pytest
from sqlalchemy import select

from app.db.session import SessionLocal
from app.modules.creators import builder, mine
from app.modules.creators.models import TravellerTrip
from app.modules.reels.models import CreatorContent, ImportStatus, ReelImport
from tests.conftest import auth

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
    names = {i["name"] for i in plan["items"]}
    assert names == {m["name"] for m in must()}  # every place, once, and no invented ones
    assert {i["day"] for i in plan["items"]} <= {1, 2, 3}
    assert all(i["origin"] == "reel" for i in plan["items"])
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
    body = {"adults": 2, "kids": 2, "days": 3, "pace": "relaxed", "group": "family", "when": "Dec 12"}

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
    r = await client.post(f"/reels/imports/{job_id}/build", json={"adults": 2, "days": 3}, headers=auth(traveler))
    code = r.json()["code"]

    async def boom(*a, **k):
        raise RuntimeError("planner exploded")

    monkeypatch.setattr(builder, "build", boom)
    monkeypatch.setattr(mine, "allow", lambda *a, **k: _true())
    async with SessionLocal() as session:
        await mine.run_build(session, FakeAI(good_plan()), code)
    got = (await client.get(f"/my-trips/{code}")).json()
    assert got["build_status"] == "failed" and got["build_error"] and len(got["items"]) == 5  # kept its stops
    again = await client.patch(f"/my-trips/{code}", json={"adults": 2, "days": 3})  # same details: retry anyway
    assert again.json()["build_status"] == "building" and builds.count(code) == 2


async def test_only_the_traveller_whose_reel_it_is_can_build_from_it(client, traveler, editor):
    job_id = await _import_for(traveler)
    assert (await client.post(f"/reels/imports/{job_id}/build", json={}, headers=auth(editor))).status_code == 404
    assert (await client.post(f"/reels/imports/{job_id}/build", json={})).status_code == 401
    async with SessionLocal() as session:
        job = await session.get(ReelImport, job_id)
        job.status = ImportStatus.RUNNING
        await session.commit()
    assert (await client.post(f"/reels/imports/{job_id}/build", json={}, headers=auth(traveler))).status_code == 409
    assert (await client.post(f"/reels/imports/{job_id}/build", json={"adults": 0, "kids": 0}, headers=auth(traveler))).status_code in (400, 409)
    async with SessionLocal() as session:
        assert (await session.scalars(select(TravellerTrip))).all() == []


async def test_the_trip_knows_when_it_starts_and_where_from(client, traveler, builds):
    import datetime as dt

    job_id = await _import_for(traveler)
    start = dt.date.today() + dt.timedelta(days=40)
    body = {"adults": 2, "days": 3, "pace": "relaxed", "group": "couple",
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

    # Without a date it keeps what they typed, and a past date or an odd code is refused.
    r = await client.patch(f"/my-trips/{trip['code']}", json={**body, "start_date": None, "when": "  sometime  in March "})
    assert r.json()["start_date"] is None and r.json()["end_date"] is None and r.json()["when"] == "sometime in March"
    past = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    for bad in ({"start_date": past}, {"origin": "DELHI"}, {"origin": "D3L"}):  # too long: 422; not letters: 400
        assert (await client.patch(f"/my-trips/{trip['code']}", json={**body, **bad})).status_code in (400, 422), bad


def test_rooms_and_nights_follow_the_party_and_where_they_sleep():
    import datetime as dt

    from app.modules.creators import stay_prices as sp

    assert [r.adults for r in sp.rooms_for(2, 0)] == [2]
    assert [r.adults for r in sp.rooms_for(5, 2)] == [2, 2, 1]
    assert sp.rooms_for(2, 2)[0].child_ages == [sp.ASSUMED_CHILD_AGE] * 2 and sp.rooms_for(4, 2)[1].child_ages == []
    start = dt.date(2027, 1, 10)
    one = sp.stay_nights([{"id": "a", "day": 1}], start, 4)
    assert one["a"] == (start, dt.date(2027, 1, 13))  # a 4-day plan: 3 nights
    two = sp.stay_nights([{"id": "b", "day": 3}, {"id": "a", "day": 1}], start, 5)
    assert two["a"] == (start, dt.date(2027, 1, 12)) and two["b"] == (dt.date(2027, 1, 12), dt.date(2027, 1, 14))


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
    body = {"adults": 2, "kids": 1, "days": 3, "pace": "relaxed", "group": "family", "start_date": start.isoformat()}
    trip = (await client.post(f"/reels/imports/{job_id}/build", json=body, headers=auth(traveler))).json()

    got = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()
    (stay,) = got["stays"]
    assert stay["status"] == "priced" and stay["hotel"]["id"] == "h1" and stay["nights"] == 2
    assert stay["check_in"] == start.isoformat() and stay["check_out"] == (start + dt.timedelta(days=2)).isoformat()
    assert stay["total"] == 13200 and stay["room"] == "Standard" and got["total"] == 13200  # the cheapest rate
    assert got["all_priced"] and got["rooms"] == 1 and got["children_assumed_age"] == sp.ASSUMED_CHILD_AGE
    assert fake.calls[0]["rooms"] == [{"adults": 2, "children": 1, "childAge": [sp.ASSUMED_CHILD_AGE]}]

    # No dates: the stay is matched but not priced, and TripJack is not asked.
    fake.calls.clear()
    await client.patch(f"/my-trips/{trip['code']}", json={**body, "start_date": None})
    got = (await client.get(f"/my-trips/{trip['code']}/stay-prices")).json()
    assert got["stays"][0]["status"] == "no_dates" and got["total"] == 0 and not got["all_priced"] and fake.calls == []


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
    body = {"adults": 2, "kids": 1, "days": 4, "pace": "relaxed", "group": "family", "start_date": start.isoformat(), "origin": "DEL", "origin_city": "Delhi"}
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

    # No from-city, no date, an airport we don't know, or flying to where they live: not priced.
    for change, status in (({"origin": ""}, "no_origin"), ({"start_date": None}, "no_dates"), ({"origin": "GOI"}, "same_city")):
        await client.patch(f"/my-trips/{trip['code']}", json={**body, **change})
        assert (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()["status"] == status
    async with SessionLocal() as session:
        row = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == trip["code"]))
        row.destination_name = "Atlantis"
        await session.commit()
    await client.patch(f"/my-trips/{trip['code']}", json=body)
    assert (await client.get(f"/my-trips/{trip['code']}/flight-price")).json()["status"] == "no_airport"
