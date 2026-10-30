"""Which TripJack hotel is this stay? Name matching that survives how people write hotel names,
the saved match on each stay, and the staff review of it."""

import re

import pytest
from sqlalchemy import select

from app.db.session import SessionLocal
from app.modules.creators.models import CreatorTrip
from app.modules.hotels import matching, photos
from app.modules.hotels.models import StayMatch, SupplierHotel, SupplierRegion
from tests.conftest import auth
from tests.test_creator_trips import (  # noqa: F401  (the fixtures these tests need)
    _approved_creator,
    _make_trip,
    fake_reel,
    plain_itineraries,
)

HOTELS = [
    "Grand Mega Resort & Spa Bali", "Alila Seminyak", "The Mulia, Mulia Resort & Villas",
    "Mandapa, a Ritz-Carlton Reserve", "Four Seasons Resort Bali at Sayan", "Sudamala Suites & Villas",
    "Hanging Gardens of Bali", "Bisma Eight Ubud", "Komaneka at Bisma", "Kamandalu Ubud",
    "Padma Resort Legian", "Padma Resort Ubud", "Hard Rock Hotel Bali", "The Legian Seminyak",
    "W Bali - Seminyak", "Amankila", "Alaya Resort Ubud", "Maya Ubud Resort & Spa",
    "Sofitel Bali Nusa Dua Beach Resort", "Ayana Resort Bali", "Rimba Jimbaran by Ayana",
    "BALI PARADISE BEACH", "Paradise Inn Kuta", "Mega Palace Hotel", "Grand Hyatt Bali",
    "Hyatt Regency Bali", "Bali Mandira Beach Resort & Spa", "Discovery Kartika Plaza Hotel",
    "Pullman Bali Legian Nirwana", "Novotel Bali Benoa", "Ibis Bali Kuta", "Fairmont Sanur Beach Bali",
    "Intercontinental Bali Resort", "Jimbaran Bay Beach Resort", "Samabe Bali Suites & Villas",
    "Uluwatu Surf Villas", "Bulgari Resort Bali", "Raffles Bali", "Capella Ubud", "Viceroy Bali",
]


@pytest.fixture
async def catalogue():
    async with SessionLocal() as session:
        for i, name in enumerate(HOTELS):
            session.add(SupplierHotel(tj_hotel_id=f"h{i}", region_id=1, name=name, city="Bali",
                                      country="Indonesia", hero_image=f"https://img.example/{i}.jpg"))  # fmt: skip
        await session.commit()


def test_noise_around_a_hotel_name_is_stripped():
    for written, clean in {
        "Grand Mega Resort & Spa or similar": "Grand Mega Resort & Spa",
        "Alila Seminyak - 5 nights": "Alila Seminyak",
        "Check in · Jimbaran Bay cliff resort": "Jimbaran Bay cliff resort",
        "The Mulia (5 star) in Nusa Dua": "The Mulia",
        "Stay at Mandapa": "Mandapa",
        "Hotel in Kuta": "Hotel in Kuta",
    }.items():
        assert matching.clean_name(written) == clean, written


def test_scores_say_how_sure_we_are():
    s = matching.score
    assert s("Grand Mega Resort & Spa or similar", "Grand Mega Resort & Spa Bali", "Bali") >= matching.CONFIDENT
    assert s("Alia Seminyak", "Alila Seminyak", "Bali") >= matching.CONFIDENT  # a typo
    assert s("Ritz Carlton Mandapa", "Mandapa, a Ritz-Carlton Reserve", "Bali") >= matching.CONFIDENT
    # One common word is never enough to call it the same hotel…
    assert matching.REVIEW <= s("Hotel Paradise", "BALI PARADISE BEACH", "Bali") < matching.CONFIDENT
    # …and different hotels that share a word don't pass for each other.
    assert s("Hotel Mega", "Grand Mega Resort & Spa Bali", "Bali") < matching.REVIEW
    assert s("Hyatt Regency Bali", "Grand Hyatt Bali", "Bali") < matching.CONFIDENT
    assert s("", "Alila Seminyak") == 0 and s("Hotel", "Alila Seminyak") == 0


VARIANTS = {
    "exact": lambda n: n,
    "or similar": lambda n: n + " or similar",
    "without hotel words": lambda n: re.sub(r"\b(hotel|resort|villas?|spa|suites?)\b", "", n, flags=re.I).strip(),
    "nights": lambda n: n + " - 5 nights",
    "lowercase, no punctuation": lambda n: re.sub(r"[&,.-]", " ", n.lower()),
    "star rating": lambda n: n + " (5 star)",
    "stay at": lambda n: "Stay at " + n,
}  # fmt: skip


async def test_hotel_names_are_found_however_they_are_written(catalogue):
    """The benchmark: real-looking names, written six ways. Never the wrong hotel; found nearly
    always. (A hotel whose name is also the start of another's may wait for review.)"""
    async with SessionLocal() as session:
        hotels = list((await session.scalars(select(SupplierHotel))).all())
        by_name = {h.name: h for h in hotels}
        report = {}
        for label, write in VARIANTS.items():
            found = wrong = 0
            for h in hotels:
                got, value = await photos.best(session, write(h.name), "Bali")
                if got is not None and value >= matching.CONFIDENT:
                    if matching.words(got.name) == matching.words(h.name):
                        found += 1
                    else:
                        wrong += 1
            report[label] = (found, wrong)
        assert all(w == 0 for _, w in report.values()), report  # a wrong photo is the worst case
        assert report["exact"][0] >= len(hotels) - 2, report
        for label, (found, _) in report.items():
            assert found >= len(hotels) * 0.8, (label, report)
        assert by_name  # (the catalogue was there)


async def test_a_hotel_not_in_the_catalogue_is_not_invented(catalogue):
    async with SessionLocal() as session:
        for name in ("The Ritz Paris", "Hotel Indonesia Kempinski", "Hotel Paradise", "Some Villa"):
            got, value = await photos.best(session, name, "Bali")
            assert got is None or value < matching.CONFIDENT, (name, got and got.name, value)


async def test_two_equally_good_hotels_wait_for_staff(catalogue):
    async with SessionLocal() as session:
        # "Padma Resort" fits both Padma hotels equally well.
        got, value = await photos.best(session, "Padma Resort", "Bali")
        assert value < matching.CONFIDENT


async def _trip_with_stay(client, admin, fake_reel, name):  # noqa: F811
    headers = await _approved_creator(client, admin, "stays-match@creators.example.com")
    trip = await _make_trip(client, headers)
    items = [{"id": "stay1", "kind": "stay", "name": name, "day": 1},
             {"id": "sight1", "kind": "sight", "name": "Tanah Lot", "day": 1}]  # fmt: skip
    r = await client.patch(f"/creator/trips/{trip['id']}", json={"items": items}, headers=headers)
    assert r.status_code == 200, r.text
    return headers, trip, r.json()


async def test_the_match_is_saved_and_survives_a_look_again(client, admin, fake_reel, catalogue):  # noqa: F811
    headers, trip, read = await _trip_with_stay(client, admin, fake_reel, "Grand Mega Resort & Spa Bali or similar")
    stay = next(i for i in read["items"] if i["id"] == "stay1")
    assert stay["image_url"] == "https://img.example/0.jpg" and stay["image_hotel"] == "Grand Mega Resort & Spa Bali"
    async with SessionLocal() as session:
        [row] = (await session.scalars(select(StayMatch))).all()
        assert (row.item_id, row.state) == ("stay1", "matched") and row.score >= matching.CONFIDENT
        assert row.hotel_id is not None


async def test_staff_review_confirm_change_unlink_and_reset(client, admin, fake_reel, catalogue):  # noqa: F811
    staff = auth(admin)
    headers, trip, _ = await _trip_with_stay(client, admin, fake_reel, "Hotel Paradise")
    listed = (await client.get("/hotel-matches", headers=staff)).json()
    assert listed["counts"]["review"] == 1 and listed["total"] == 1
    row = listed["items"][0]
    assert row["state"] == "review" and row["stay_name"] == "Hotel Paradise"
    assert row["trip_title"] == trip["title"] and row["hotel"]["name"] == "BALI PARADISE BEACH"

    # A review match shows no photo to travellers…
    got = (await client.get(f"/creator/trips/{trip['id']}", headers=headers)).json()
    assert next(i for i in got["items"] if i["id"] == "stay1")["image_url"] is None

    # …until staff confirm it. Searching finds the hotel staff mean.
    found = (await client.get(f"/hotel-matches/{row['id']}/candidates", params={"q": "paradise inn"}, headers=staff)).json()
    inn = next(c for c in found if c["hotel"]["name"] == "Paradise Inn Kuta")
    assert inn["hotel"]["hero_image"] and 0 < inn["score"] <= 1
    done = (await client.put(f"/hotel-matches/{row['id']}", json={"hotel_id": inn["hotel"]["id"]}, headers=staff)).json()
    assert done["state"] == "confirmed" and done["hotel"]["name"] == "Paradise Inn Kuta"
    assert done["decided_by"] == "admin@example.com" or done["decided_by"]
    got = (await client.get(f"/creator/trips/{trip['id']}", headers=headers)).json()
    stay = next(i for i in got["items"] if i["id"] == "stay1")
    assert stay["image_hotel"] == "Paradise Inn Kuta"

    # A staff decision outlasts the creator renaming the stay.
    items = [{"id": "stay1", "kind": "stay", "name": "Somewhere else entirely", "day": 1}]
    await client.patch(f"/creator/trips/{trip['id']}", json={"items": items}, headers=headers)
    got = (await client.get(f"/creator/trips/{trip['id']}", headers=headers)).json()
    assert got["items"][0]["image_hotel"] == "Paradise Inn Kuta"

    # Unlink: nothing shown, and it is not matched again.
    un = (await client.post(f"/hotel-matches/{row['id']}/unlink", headers=staff)).json()
    assert un["state"] == "unlinked" and un["hotel"] is None
    got = (await client.get(f"/creator/trips/{trip['id']}", headers=headers)).json()
    assert got["items"][0]["image_url"] is None
    assert (await client.get("/hotel-matches", params={"state": "unlinked"}, headers=staff)).json()["total"] == 1

    # Reset: forget the decision and match by name again.
    again = (await client.post(f"/hotel-matches/{row['id']}/reset", headers=staff)).json()
    assert again["state"] in ("nomatch", "review", "matched") and again["state"] != "unlinked"

    # Staff only.
    assert (await client.get("/hotel-matches", headers=headers)).status_code in (401, 403)
    assert (await client.get("/hotel-matches")).status_code == 401
    assert (await client.put(f"/hotel-matches/{row['id']}", json={"hotel_id": inn["hotel"]["id"]})).status_code == 401


async def test_a_renamed_stay_is_matched_again(client, admin, fake_reel, catalogue):  # noqa: F811
    headers, trip, read = await _trip_with_stay(client, admin, fake_reel, "Alila Seminyak")
    assert next(i for i in read["items"] if i["id"] == "stay1")["image_hotel"] == "Alila Seminyak"
    items = [{"id": "stay1", "kind": "stay", "name": "Amankila", "day": 1}]
    r = await client.patch(f"/creator/trips/{trip['id']}", json={"items": items}, headers=headers)
    assert r.json()["items"][0]["image_hotel"] == "Amankila"
    async with SessionLocal() as session:
        trips = (await session.scalars(select(CreatorTrip))).all()
        assert len(trips) == 1
        [row] = (await session.scalars(select(StayMatch))).all()
        assert row.stay_name == "Amankila"


async def _publish(client, headers, trip) -> str:
    r = await client.patch(f"/creator/trips/{trip['id']}", json={"publish": True}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["share_code"]


async def test_opening_a_stay_shows_its_hotel(client, admin, fake_reel, catalogue):  # noqa: F811
    headers, trip, _ = await _trip_with_stay(client, admin, fake_reel, "Alila Seminyak or similar")
    code = await _publish(client, headers, trip)
    r = await client.get(f"/trips/{code}/stops/stay1")  # public, like the trip itself
    assert r.status_code == 200, r.text
    stop = r.json()
    assert stop["hotel"]["name"] == "Alila Seminyak" and stop["alternatives"] == []
    assert stop["hotel"]["images"][0]["url"] == "https://img.example/1.jpg"


async def test_a_stay_that_matches_no_hotel_gets_alternatives(client, admin, fake_reel, catalogue):  # noqa: F811
    headers, trip, _ = await _trip_with_stay(client, admin, fake_reel, "Hotel Paradise")
    code = await _publish(client, headers, trip)
    stop = (await client.get(f"/trips/{code}/stops/stay1")).json()
    assert stop["hotel"] is None  # a likely match waits for staff: it is not claimed as the hotel
    assert 1 <= len(stop["alternatives"]) <= 3
    assert stop["alternatives"][0]["hotel"]["name"] == "BALI PARADISE BEACH"
    assert stop["alternatives"][0]["reason"] == "Close to the name in the reel"


async def test_a_sight_has_no_hotel_and_a_missing_stop_is_404(client, admin, fake_reel, catalogue):  # noqa: F811
    headers, trip, _ = await _trip_with_stay(client, admin, fake_reel, "Alila Seminyak")
    code = await _publish(client, headers, trip)
    sight = (await client.get(f"/trips/{code}/stops/sight1")).json()
    assert sight["name"] == "Tanah Lot" and sight["hotel"] is None and sight["alternatives"] == []
    assert (await client.get(f"/trips/{code}/stops/nope")).status_code == 404


async def test_a_bali_trip_is_in_indonesia_never_the_bali_in_rajasthan():
    from app.modules.creators import stays

    async with SessionLocal() as session:
        session.add_all([
            SupplierRegion(region_id=185149, city_name="BALI", country_name="INDIA",
                           full_name="BALI, RAJASTHAN, INDIA", hotel_count=106),
            SupplierRegion(region_id=718650, city_name="BALI", country_name="INDONESIA",
                           full_name="BALI, INDONESIA", hotel_count=15033),
            SupplierRegion(region_id=500, city_name="PUNE", country_name="INDIA",
                           full_name="PUNE, MAHARASHTRA, INDIA", hotel_count=900),
        ])  # fmt: skip
        session.add_all([
            SupplierHotel(tj_hotel_id="raj", region_id=185149, name="Praveg Caves Jawai", star_rating=4,
                          rank=99, hero_image="https://img.example/r.jpg", city="BALI", country="India"),
            SupplierHotel(tj_hotel_id="kuta", region_id=718650, name="Grand Mega Resort & Spa Bali",
                          star_rating=4, rank=50, hero_image="https://img.example/k.jpg", city="KUTA",
                          country="Indonesia"),
        ])  # fmt: skip
        await session.commit()

        # Both are a "Bali" TripJack knows; the one with thousands of hotels is the trip's.
        assert await photos.destination_country(session, "Bali") == "INDONESIA"
        # A country or a state is a destination too.
        assert await photos.destination_country(session, "Indonesia") == "INDONESIA"
        assert await photos.destination_country(session, "Maharashtra") == "INDIA"
        # Picking a hotel for "Stay in Ubud" on a Bali trip: never the better-ranked one in Rajasthan.
        picked = await stays.fitting_hotels(session, "Bali", (3.0, 4.5))
        assert [h.tj_hotel_id for h in picked] == ["kuta"]
        # Matching a stay by name stays in the country too: the Rajasthan hotel is no Bali stay.
        hotel, _ = await photos.best(session, "Praveg Caves Jawai", "Bali")
        assert hotel is None
        hotel, _ = await photos.best(session, "Grand Mega Resort & Spa", "Bali")
        assert hotel is not None and hotel.tj_hotel_id == "kuta"
