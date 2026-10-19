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
        "pricing": {"basePrice": total, "taxes": 100, "mf": 20, "mft": 4, "discount": 0,
                    "totalPrice": total + 124, "currency": "INR"},
        "commercial": {"type": "NET"},
        "compliance": {"gstType": "NA", "panRequired": True, "passportRequired": False},
        "cancellation": {
            "isRefundable": True,
            "penalties": [
                {"from": (now - timedelta(days=1)).isoformat(),
                 "to": (now + timedelta(days=5)).isoformat(), "amount": 0},
                {"from": (now + timedelta(days=5)).isoformat(),
                 "to": (now + timedelta(days=9)).isoformat(), "amount": total},
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
    fields = hotel_fields({
        "tjHotelId": "1", "name": "Pride", "star_rating": "5", "is_active": True,
        "property_type": {"name": "Hotel"},
        "locale": {"address": {"fulladdr": "Aerocity", "city": "Delhi", "countryname": "India"},
                   "coordinates": {"lat": 28.5, "long": 77.1}},
        "amenities": {"0": {"name": "Pool"}, "1": {"name": "Wifi"}},
        "images": [{"caption": "x", "links": {"Standard": {"href": "http://a/1.jpg"}}},
                   {"is_hero_image": True, "links": {"Standard": {"href": "http://a/hero.jpg"}}}],
        "descriptions": {"headline": "Nice", "default": '{"Overview": "A big hotel"}'},
        "policies": {"know_before_you_go": '{"Children Policy": "2 to 12"}'},
    })
    assert fields["hero_image"] == "http://a/hero.jpg" and fields["images"][0]["url"].endswith("hero.jpg")
    assert fields["amenities"] == ["Pool", "Wifi"] and fields["star_rating"] == 5
    assert fields["description"] == "A big hotel" and fields["policies"] == {"Children Policy": "2 to 12"}
    assert fields["rank"] > 50


class FakeTripJack:
    configured = True

    def __init__(self):
        self.calls = []

    async def listing(self, *, hids, **kw):
        self.calls.append(list(hids))
        return [{"tjHotelId": h, "name": f"H{h}", "options": [_option(1000 + int(h))]} for h in hids]


async def _seed(n: int):
    async with SessionLocal() as s:
        s.add(SupplierRegion(region_id=7, city_name="Goa", country_name="INDIA",
                             mapping_synced_at=datetime.now(IST), content_synced_at=datetime.now(IST)))
        for i in range(n):
            s.add(SupplierHotel(tj_hotel_id=str(i), region_id=7, name=f"Hotel {i}",
                                content_synced_at=datetime.now(IST), rank=i))
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
    assert [len(c) for c in fake.calls] == [100, 100, 50] or sorted(len(c) for c in fake.calls) == [50, 100, 100]
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
                s, HotelSearch(city="nowhere", check_in=tomorrow, check_out=tomorrow + timedelta(days=1))
            )


async def test_search_needs_login_and_reports_missing_key(client, traveler, monkeypatch):
    body = {"city": "goa", "check_in": str(date.today() + timedelta(days=3)),
            "check_out": str(date.today() + timedelta(days=5))}
    assert (await client.post("/hotels/search", json=body)).status_code == 401
    r = await client.post("/hotels/search", json=body, headers=auth(traveler))
    assert r.status_code == 404  # no region synced yet
