from datetime import date, timedelta

import pytest

from app.modules.flights import pricing, service as flight_service
from app.modules.flights.schemas import FlightSearch, Leg
from app.modules.insurance import service as ins_service
from app.modules.insurance.schemas import InsuranceSearch
from tests.conftest import auth

TOMORROW = date.today() + timedelta(days=1)


def _raw_trip():
    seg = lambda n, a, b, dt, at, ct=0: {  # noqa: E731
        "fD": {"aI": {"code": "6E", "name": "IndiGo", "isLcc": True}, "fN": n},
        "da": {"code": a, "city": a}, "aa": {"code": b, "city": b},
        "dt": dt, "at": at, "duration": 120, "cT": ct, "stops": 0,
    }
    fare = lambda i, bf, rt=1: {  # noqa: E731
        "id": i, "fareIdentifier": "PUBLISHED",
        "fd": {
            "ADULT": {"fC": {"BF": bf, "TAF": 100, "TF": bf + 100, "NCM": 7}, "rT": rt, "cc": "ECONOMY",
                      "bI": {"iB": "15 KG", "cB": "7 KG"}, "sR": 4},
            "CHILD": {"fC": {"BF": bf / 2, "TAF": 50, "TF": bf / 2 + 50}},
        },
    }
    return {
        "sI": [seg("101", "DEL", "BOM", "2026-11-20T06:00", "2026-11-20T08:00", 60),
               seg("102", "BOM", "GOI", "2026-11-20T09:00", "2026-11-20T10:00")],
        "totalPriceList": [fare("p2", 5000, 0), fare("p1", 3000)],
    }


def test_flight_normalise_prices_party_and_hides_commission(monkeypatch):
    monkeypatch.setattr(pricing.settings, "tripjack_flight_markup_percent", 10)
    body = {"searchResult": {"tripInfos": {"ONWARD": [_raw_trip()]}}}
    [trip] = pricing.normalise(body, {"ADULT": 2, "CHILD": 1, "INFANT": 0}, [("DEL", "GOI")])
    cheapest = trip["cheapest"]
    assert cheapest["price_id"] == "p1"
    # base: (3000*2 + 1500) * 1.10, taxes pass through: 100*2 + 50
    assert cheapest["price"] == {"base": 8250.0, "taxes": 250.0, "total": 8500.0, "currency": "INR"}
    assert "NCM" not in str(trip) and trip["stops"] == 1
    assert trip["duration_minutes"] == 120 + 60 + 120
    assert cheapest["refundable"] == "refundable" and trip["fares"][1]["refundable"] == "non_refundable"
    assert cheapest["baggage"]["check_in"] == "15 KG"


def test_combo_trip_splits_into_legs():
    segs = [
        {"from": {"code": "DEL"}, "to": {"code": "LHR"}},
        {"from": {"code": "LHR"}, "to": {"code": "DEL"}},
    ]
    legs = pricing.split_legs(segs, [("DEL", "LHR"), ("LHR", "DEL")])
    assert [len(leg) for leg in legs] == [1, 1]


def test_flight_search_rules():
    with pytest.raises(ValueError):
        FlightSearch(legs=[Leg(origin="DEL", destination="DEL", date=TOMORROW)])
    with pytest.raises(ValueError):
        FlightSearch(legs=[Leg(origin="DEL", destination="BOM", date=TOMORROW)], adults=1, infants=2)
    q = FlightSearch(legs=[Leg(origin="del", destination="bom", date=TOMORROW)], children=1)
    assert q.to_tripjack()["paxInfo"] == {"ADULT": "1", "CHILD": "1"}


async def test_flight_search_endpoint_uses_cache_and_sorts(client, traveler, monkeypatch):
    calls = []

    class Fake:
        async def search(self, query):
            calls.append(query)
            return {"searchResult": {"tripInfos": {"ONWARD": [_raw_trip()]}}}

    store: dict = {}
    async def get(k): return store.get(k)  # noqa: E704
    async def put(k, v, ttl): store[k] = v  # noqa: E704
    monkeypatch.setattr(flight_service, "tripjack_flights", Fake())
    monkeypatch.setattr(flight_service, "cache_get", get)
    monkeypatch.setattr(flight_service, "cache_set", put)
    body = {"legs": [{"origin": "DEL", "destination": "GOI", "date": str(TOMORROW)}]}
    for _ in range(2):
        r = await client.post("/flights/search", json=body, headers=auth(traveler))
        assert r.status_code == 200, r.text
        assert r.json()["flights"][0]["cheapest"]["price"]["total"] == 3100
    assert len(calls) == 1  # the second search came from the cache
    assert (await client.post("/flights/search", json=body)).status_code == 401


def test_fare_rules_are_flattened():
    out = pricing.fare_rules({"fareRule": {"tfr": {"CANCELLATION": [
        {"amount": 3500, "additionalFee": 300, "st": 0, "et": 2, "policyInfo": "x"}]}}})
    assert out["rules"]["CANCELLATION"][0]["airline_fee"] == 3500


def _plan_raw():
    return {
        "productId": "ABHI-1", "planCoverage": "$50,000", "insuranceProvider": "ABHI",
        "regionName": "INDIA", "planType": "REGULAR",
        "fareDetails": {"totalFare": 118.0, "agentCommission": 9.0},
        "productBenefits": [
            {"name": "$50k Medical", "type": "INSURANCE_BENEFIT", "visibility": "BANNER"},
            {"name": "Outpatient", "type": "INSURANCE_BENEFIT", "visibility": "POPUP",
             "iconCategory": "Medical Covers", "description": "d"},
            {"name": "Outpatient", "type": "ASSISTANCE_BENEFIT", "visibility": "POPUP",
             "iconCategory": "Medical Covers"},
        ],
        "paxFareDetails": [{"age": 30, "insuranceFareComponents": {"TF": 118.0}}],
    }


def test_insurance_plan_normalised(monkeypatch):
    monkeypatch.setattr(ins_service.settings, "tripjack_insurance_markup_percent", 10)
    p = ins_service.plan(_plan_raw())
    assert p["price"]["total"] == 129.8 and "agentCommission" not in str(p)
    assert p["highlights"] == ["$50k Medical"]
    assert list(p["benefits"]) == ["Medical Covers"] and len(p["benefits"]["Medical Covers"]) == 1


def test_insurance_rules():
    base = dict(start_date=TOMORROW, traveller_dobs=[date(1990, 1, 1)])
    ok = InsuranceSearch(**base, end_date=TOMORROW + timedelta(days=9),
                         destinations=[{"key": "us"}])
    assert ok.to_tripjack()["destinations"] == [{"key": "US", "type": "COUNTRY"}]
    for bad in (
        dict(destinations=[{"key": "IR"}], end_date=TOMORROW + timedelta(days=5)),
        dict(destinations=[{"key": "IN"}], end_date=TOMORROW + timedelta(days=40)),
        dict(destinations=[{"key": "US"}], plan_type="STUDENT", end_date=TOMORROW + timedelta(days=44)),
        dict(destinations=[{"key": "US"}], plan_type="AMT", coverage_duration=50),
        dict(destinations=[{"key": "US"}]),
    ):
        with pytest.raises(ValueError):
            InsuranceSearch(**base, **bad)
    with pytest.raises(ValueError):
        InsuranceSearch(start_date=TOMORROW, traveller_dobs=[date(1940, 1, 1)],
                        destinations=[{"key": "US"}], end_date=TOMORROW + timedelta(days=3))
