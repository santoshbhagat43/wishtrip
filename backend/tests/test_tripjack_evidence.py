"""Where did the data come from? Every real TripJack call is recorded, responses say which calls
they were built from, and staff can read back the values TripJack returned."""

import json
from datetime import date, timedelta

import httpx
import pytest

from app.core.config import settings
from app.modules.flights.client import tripjack_flights
from app.modules.hotels.client import tripjack_hotels
from app.modules.tripjack import cache, trace
from tests.conftest import auth

KEY = "tj-secret-key-for-tests-0123456789"


class FakeRedis:
    def __init__(self):
        self.data: dict[str, str] = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value, ex=None):
        self.data[key] = value


@pytest.fixture(autouse=True)
def redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(cache, "_client", lambda: fake)
    monkeypatch.setattr(trace, "_client", lambda: fake)
    monkeypatch.setattr(settings, "tripjack_api_key", KEY)
    monkeypatch.setattr(settings, "tripjack_search_url", "https://apitest-hms.tripjack.com")
    monkeypatch.setattr(settings, "tripjack_api_url", "https://apitest.tripjack.com")
    return fake


def upstream(monkeypatch, client, handler):
    """Make `client` talk to a canned TripJack."""
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler), headers={"apikey": KEY})
    monkeypatch.setattr(client, "_client", lambda: http)


LISTING = {
    "status": {"success": True},
    "hotels": [
        {
            "hotelId": "100001538018",
            "name": "La Estoria, Goa",
            "options": [
                {
                    "optionId": "o-1",
                    "mealBasis": "Breakfast",
                    "roomInfo": [{"name": "Superior Room"}],
                    "pricing": {"totalPrice": 20193.65, "basePrice": 16763.79, "taxes": 3429.86,
                                "mf": 0, "mft": 0, "currency": "INR"},
                }
            ],
        }
    ],
}  # fmt: skip


async def test_a_call_is_recorded_with_its_timing_and_the_values_tripjack_sent(monkeypatch):
    upstream(monkeypatch, tripjack_hotels, lambda r: httpx.Response(200, json=LISTING))
    tr = trace.start()
    await tripjack_hotels.listing(
        hids=["100001538018"], check_in="2026-12-01", check_out="2026-12-03",
        rooms=[{"adults": 2}], correlation_id="c1",
    )  # fmt: skip
    [call] = tr.calls
    assert (call.product, call.host, call.path) == (
        "hotels", "apitest-hms.tripjack.com", "/hms/v3/hotel/listing",
    )  # fmt: skip
    assert call.status == 200 and call.ok and call.bytes > 100 and call.ms >= 0
    row = call.excerpt["hotels"][0]
    assert row["hotelId"] == "100001538018" and row["name"] == "La Estoria, Goa"
    assert row["options"][0]["total"] == 20193.65 and row["options"][0]["base"] == 16763.79


async def test_the_api_key_never_reaches_the_record(monkeypatch):
    seen = {}

    def handler(request):
        seen["apikey"] = request.headers.get("apikey")
        return httpx.Response(200, json=LISTING)

    upstream(monkeypatch, tripjack_hotels, handler)
    tr = trace.start()
    await tripjack_hotels.listing(
        hids=["1"], check_in="2026-12-01", check_out="2026-12-02", rooms=[{"adults": 1}],
        correlation_id="c1",
    )  # fmt: skip
    assert seen["apikey"] == KEY  # it was sent to TripJack...
    stored = json.dumps(tr.evidence()) + json.dumps(tr.public())
    assert KEY not in stored  # ...and is nowhere in what we keep or show


async def test_a_failed_call_is_recorded_too(monkeypatch):
    err = {"status": {"success": False}, "error": {"code": "6535", "message": "price changed"}}
    upstream(monkeypatch, tripjack_hotels, lambda r: httpx.Response(200, json=err))
    tr = trace.start()
    with pytest.raises(Exception, match="6535"):
        await tripjack_hotels.pricing(
            hid="1", check_in="2026-12-01", check_out="2026-12-02", rooms=[{"adults": 1}],
            correlation_id="c1",
        )  # fmt: skip
    [call] = tr.calls
    assert not call.ok and call.status == 200 and "6535" in call.error


def flight_body(base=3000):
    return {
        "status": {"success": True},
        "searchResult": {"tripInfos": {"ONWARD": [{
            "sI": [{"fD": {"aI": {"code": "6E", "name": "IndiGo", "isLcc": True}, "fN": "101"},
                    "da": {"code": "DEL"}, "aa": {"code": "GOI"},
                    "dt": "2026-12-01T06:00", "at": "2026-12-01T08:30", "duration": 150}],
            "totalPriceList": [{"id": "price-1", "fareIdentifier": "PUBLISHED",
                                "fd": {"ADULT": {"fC": {"BF": base, "TAF": 400, "TF": base + 400},
                                                 "rT": 1, "cc": "ECONOMY"}}}],
        }]}},
    }  # fmt: skip


def flight_search():
    return {
        "legs": [{"origin": "DEL", "destination": "GOI",
                  "date": (date.today() + timedelta(days=20)).isoformat()}],
        "adults": 1,
    }  # fmt: skip


async def test_a_response_says_which_tripjack_calls_it_was_built_from(
    client, traveler, admin, monkeypatch
):
    upstream(monkeypatch, tripjack_flights, lambda r: httpx.Response(200, json=flight_body()))
    r = await client.post("/flights/search", json=flight_search(), headers=auth(traveler))
    assert r.status_code == 200, r.text
    body = r.json()
    supplier = body["supplier"]
    assert supplier["name"] == "tripjack" and supplier["served_from"] == "tripjack"
    assert supplier["environment"].startswith("UAT")
    assert supplier["calls"][0]["endpoint"] == "POST apitest.tripjack.com/fms/v1/air-search-all"
    assert supplier["calls"][0]["status"] == 200 and supplier["upstream_ms"] >= 0

    # Staff can read back exactly what TripJack sent, and it matches what we show.
    ev = await client.get(f"/tripjack/evidence/{supplier['trace_id']}", headers=auth(admin))
    assert ev.status_code == 200, ev.text
    [call] = ev.json()["calls"]
    fare = call["excerpt"]["trips"][0]["fares"][0]
    assert fare["id"] == body["flights"][0]["cheapest"]["price_id"] == "price-1"
    assert fare["adult"] == {"BF": 3000, "TAF": 400, "TF": 3400}
    assert body["flights"][0]["cheapest"]["price"]["total"] == 3400.0  # 3000 + 400, no markup


async def test_a_repeat_search_is_served_from_cache_and_points_at_the_first_call(
    client, traveler, monkeypatch
):
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, json=flight_body())

    upstream(monkeypatch, tripjack_flights, handler)
    first = (
        await client.post("/flights/search", json=flight_search(), headers=auth(traveler))
    ).json()
    second = (
        await client.post("/flights/search", json=flight_search(), headers=auth(traveler))
    ).json()

    assert len(calls) == 1  # TripJack was asked once
    assert first["supplier"]["served_from"] == "tripjack"
    assert second["supplier"]["served_from"] == "cache" and second["supplier"]["calls"] == []
    # The cached answer says which TripJack call it came from, and how old it is.
    assert second["supplier"]["cache"]["original_trace_id"] == first["supplier"]["trace_id"]
    assert second["supplier"]["cache"]["age_seconds"] >= 0
    assert "_trace" not in second and "_trace" not in json.dumps(second["flights"])


async def test_evidence_is_for_staff_only_and_expires(client, traveler, admin):
    assert (await client.get("/tripjack/evidence/abc")).status_code == 401
    assert (await client.get("/tripjack/evidence/abc", headers=auth(traveler))).status_code == 403
    missing = await client.get("/tripjack/evidence/abc", headers=auth(admin))
    assert missing.status_code == 404 and "an hour" in missing.json()["detail"]
