from datetime import date, datetime, timedelta

import pytest

from app.db.session import SessionLocal
from app.modules.hotels import service
from app.modules.hotels.models import SupplierHotel, SupplierRegion
from app.modules.hotels.pricing import IST, apply_markup, normalise_option, normalise_options
from app.modules.hotels.sync import hotel_fields
from tests.conftest import auth


def _option(total: float, **over) -> dict:
    now = datetime.now(IST).replace(tzinfo=None)
    option = {
        "optionId": "opt-1",
        "optionType": "SRSM",
        "roomInfo": [{"id": "1", "name": "Deluxe"}],
        "mealBasis": "Breakfast",
        "inclusions": [],
        "pricing": {
            "basePrice": total,
            "taxes": 100,
            "mf": 20,
            "mft": 4,
            "discount": 0,
            "totalPrice": total + 124,
            "currency": "INR",
        },
        "commercial": {"type": "NET"},
        "compliance": {"gstType": "NA", "panRequired": True, "passportRequired": False},
        "cancellation": {
            "isRefundable": True,
            "penalties": [
                {
                    "from": (now - timedelta(days=1)).isoformat(),
                    "to": (now + timedelta(days=5)).isoformat(),
                    "amount": 0,
                },
                {
                    "from": (now + timedelta(days=5)).isoformat(),
                    "to": (now + timedelta(days=9)).isoformat(),
                    "amount": total,
                },
            ],
        },
    }
    option.update(over)
    return option


def test_markup_applies_to_base_only(monkeypatch):
    monkeypatch.setattr("app.modules.hotels.pricing.settings.tripjack_markup_percent", 10)
    out = normalise_option(_option(1000))
    assert out["price"]["base"] == 1100
    assert out["price"]["management_fee"] == 20 and out["price"]["management_fee_tax"] == 4
    assert out["price"]["total"] == 1100 + 100 + 20 + 4
    assert apply_markup(200, 0) == 200


def test_free_cancellation_and_flags():
    out = normalise_option(_option(1000))
    assert out["cancellation"]["free_until"] is not None
    assert out["cancellation"]["refundable"] and len(out["cancellation"]["slabs"]) == 2
    assert out["needs_pan"] and not out["needs_passport"]


def test_unavailable_options_dropped_and_sorted():
    sold = _option(500, inventory={"available": False})
    options = normalise_options([_option(900), sold, _option(700)])
    assert [o["price"]["base"] for o in options] == [700, 900]


def test_hotel_fields_flatten_content():
    fields = hotel_fields(
        {
            "tjHotelId": "1",
            "name": "Pride",
            "star_rating": "5",
            "is_active": True,
            "property_type": {"name": "Hotel"},
            "locale": {
                "address": {"fulladdr": "Aerocity", "city": "Delhi", "countryname": "India"},
                "coordinates": {"lat": 28.5, "long": 77.1},
            },
            "amenities": {"0": {"name": "Pool"}, "1": {"name": "Wifi"}},
            "images": [
                {"caption": "x", "links": {"Standard": {"href": "http://a/1.jpg"}}},
                {"is_hero_image": True, "links": {"Standard": {"href": "http://a/hero.jpg"}}},
            ],
            "descriptions": {"headline": "Nice", "default": '{"Overview": "A big hotel"}'},
            "policies": {"know_before_you_go": '{"Children Policy": "2 to 12"}'},
        }
    )
    assert fields["hero_image"] == "http://a/hero.jpg" and fields["images"][0]["url"].endswith(
        "hero.jpg"
    )
    assert fields["amenities"] == ["Pool", "Wifi"] and fields["star_rating"] == 5
    assert fields["description"] == "A big hotel" and fields["policies"] == {
        "Children Policy": "2 to 12"
    }
    assert fields["rank"] > 50


class FakeTripJack:
    configured = True

    def __init__(self):
        self.calls = []

    async def listing(self, *, hids, **kw):
        self.calls.append(list(hids))
        return [{"hotelId": h, "name": f"H{h}", "options": [_option(1000 + int(h))]} for h in hids]


async def _seed(n: int):
    async with SessionLocal() as s:
        s.add(
            SupplierRegion(
                region_id=7,
                city_name="Goa",
                country_name="INDIA",
                mapping_synced_at=datetime.now(IST),
                content_synced_at=datetime.now(IST),
            )
        )
        for i in range(n):
            s.add(
                SupplierHotel(
                    tj_hotel_id=str(i),
                    region_id=7,
                    name=f"Hotel {i}",
                    content_synced_at=datetime.now(IST),
                    rank=i,
                )
            )
        await s.commit()


async def test_search_chunks_in_parallel_and_sorts_cheapest_first(monkeypatch):
    fake = FakeTripJack()
    monkeypatch.setattr(service, "tripjack_hotels", fake)
    monkeypatch.setattr(service, "_cache_get", lambda key: _none())
    monkeypatch.setattr(service, "_cache_set", lambda *a, **k: _none())
    await _seed(250)
    tomorrow = date.today() + timedelta(days=1)
    from app.modules.hotels.schemas import HotelSearch

    async with SessionLocal() as s:
        result = await service.search(
            s, HotelSearch(city="goa", check_in=tomorrow, check_out=tomorrow + timedelta(days=2))
        )
    assert [len(c) for c in fake.calls] == [100, 100, 50] or sorted(len(c) for c in fake.calls) == [
        50,
        100,
        100,
    ]
    prices = [h["option"]["price"]["total"] for h in result["hotels"]]
    assert prices == sorted(prices) and len(prices) == 250
    assert result["region"]["city"] == "Goa"


async def _none():
    return None


async def test_unknown_city_is_reported():
    from app.modules.hotels.schemas import HotelSearch

    tomorrow = date.today() + timedelta(days=1)
    async with SessionLocal() as s:
        with pytest.raises(service.NoDestination):
            await service.search(
                s,
                HotelSearch(
                    city="nowhere", check_in=tomorrow, check_out=tomorrow + timedelta(days=1)
                ),
            )


async def test_search_needs_login_and_reports_missing_key(client, traveler, monkeypatch):
    body = {
        "city": "goa",
        "check_in": str(date.today() + timedelta(days=3)),
        "check_out": str(date.today() + timedelta(days=5)),
    }
    assert (await client.post("/hotels/search", json=body)).status_code == 401
    r = await client.post("/hotels/search", json=body, headers=auth(traveler))
    assert r.status_code == 404  # no region synced yet


# Shapes seen on TripJack's real test environment (they differ from its documentation) --------


def test_listing_names_hotels_hotelId_but_the_docs_say_tjHotelId():
    from app.modules.hotels.service import _listing_id

    assert _listing_id({"hotelId": "100001538018"}) == "100001538018"  # what TripJack really sends
    assert _listing_id({"tjHotelId": "100001538018"}) == "100001538018"  # what the docs promise
    assert _listing_id({}) == ""


def test_no_rooms_for_those_dates_is_an_answer_not_a_failure():
    """Pricing for a hotel with nothing available is success:false with empty options and no
    error. It must read as 'no options', not as TripJack being down."""
    from app.modules.hotels.client import tripjack_hotels

    real = {
        "status": {"success": False, "httpStatus": 200},
        "hotelId": "100002392578",
        "nationality": "106",
        "options": [],
        "correlationId": "9a08f025513b42dd9835b5",
    }
    assert tripjack_hotels.read_error(real, 200, "") is None
    # A genuine error still is one, empty options or not.
    failed = {
        "status": {"success": False},
        "error": {"code": "6504", "message": "bad hotel"},
        "options": [],
    }
    assert tripjack_hotels.read_error(failed, 200, "").code == "6504"
    # And success:false without the options marker (some other failure) is still an error.
    assert tripjack_hotels.read_error({"status": {"success": False}}, 200, "boom") is not None


async def test_a_city_links_only_to_the_region_in_its_own_country(london):
    from sqlalchemy import select

    from app.modules.hotels.models import SupplierRegion
    from app.modules.hotels.sync import link_regions_to_locations

    async with SessionLocal() as s:
        s.add_all(
            [
                SupplierRegion(region_id=1, city_name="LONDON", country_name="UNITED KINGDOM",
                               full_name="LONDON, ENGLAND, UNITED KINGDOM"),
                SupplierRegion(region_id=2, city_name="LONDON", country_name="CANADA",
                               full_name="LONDON, ONTARIO, CANADA"),
                SupplierRegion(region_id=3, city_name="PARIS", country_name="FRANCE",
                               full_name="PARIS, FRANCE"),
            ]
        )
        await s.commit()
        assert await link_regions_to_locations(s) == 1
        linked = {
            r.region_id: r.location_id
            for r in (await s.execute(select(SupplierRegion))).scalars()
        }
    assert str(linked[1]) == london["city"]["id"]  # London, UK: the knowledge base's London
    assert linked[2] is None and linked[3] is None  # London, Canada: not ours
