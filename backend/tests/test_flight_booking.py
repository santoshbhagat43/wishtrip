"""Booking a TripJack flight from the dashboard (test environment only): review, hold, read the
booking and its hold deadline, ticket it or release it."""

import json

import httpx
import pytest

from app.core.config import settings
from app.modules.flights.client import tripjack_flights
from app.modules.tripjack import cache, trace
from tests.conftest import auth

REVIEW = {
    "bookingId": "TJS100",
    "totalPriceInfo": {"totalFareDetail": {"fC": {"BF": 8000, "TAF": 1200, "TF": 9200}}},
    "conditions": {"st": 900, "sct": "2026-10-28T10:00", "isBA": True, "ipa": False,
                   "dob": {"adobr": False, "idobr": True}, "pcs": {"pm": False}},
    "alerts": [],
}  # fmt: skip
HELD = {
    "order": {"bookingId": "TJS100", "status": "ON_HOLD", "amount": 0, "createdOn": "2026-10-28"},
    "itemInfos": {
        "AIR": {
            "travellerInfos": [{"fN": "Asha", "lN": "Rao", "pt": "ADULT",
                                "pnrDetails": {"DEL-GOI": "ABC123"}}],
            "totalPriceInfo": {"totalFareDetail": {"fC": {"TF": 9200}}},
            "timeLimit": "2026-10-28T22:00:00",
        }
    },
}  # fmt: skip
OK = {"status": {"success": True, "httpStatus": 200}}


class FakeRedis:
    async def get(self, key):
        return None

    async def set(self, key, value, ex=None):
        return None


@pytest.fixture(autouse=True)
def tripjack(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(cache, "_client", lambda: fake)
    monkeypatch.setattr(trace, "_client", lambda: fake)
    monkeypatch.setattr(settings, "tripjack_flight_api_key", "tj-flight-key-0123456789")
    monkeypatch.setattr(settings, "tripjack_api_url", "https://apitest.tripjack.com")


def upstream(monkeypatch, answers: dict, sent: list):
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append((request.url.path, json.loads(request.content or b"{}")))
        return httpx.Response(200, json=answers[request.url.path])

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(tripjack_flights, "_client", lambda: http)


TRAVELLER = {"type": "ADULT", "title": "Ms", "first_name": "Asha", "last_name": "Rao"}


async def test_review_hold_details_confirm_and_release(client, admin, monkeypatch):
    sent: list = []
    upstream(monkeypatch, {
        "/fms/v1/review": REVIEW, "/oms/v1/air/book": {**OK, "bookingId": "TJS100"},
        "/oms/v1/booking-details": HELD, "/oms/v1/air/fare-validate": OK,
        "/oms/v1/air/confirm-book": {**OK, "bookingId": "TJS100"}, "/oms/v1/air/unhold": OK,
    }, sent)  # fmt: skip
    staff = auth(admin)

    reviewed = (
        await client.post("/flights/review", json={"price_ids": ["p1"]}, headers=staff)
    ).json()
    assert reviewed["booking_id"] == "TJS100" and reviewed["total"] == 9200
    assert reviewed["hold_allowed"] and reviewed["session_seconds"] == 900
    assert reviewed["needs"]["dob_infant"] and not reviewed["needs"]["pan"]

    held = await client.post("/flights/book", headers=staff, json={
        "booking_id": "TJS100", "mode": "hold", "travellers": [TRAVELLER],
        "email": "test@example.com", "phone": "+919500112233"})  # fmt: skip
    assert held.status_code == 200, held.text
    path, body = sent[-1]
    # A hold carries no payment; names and contacts go as TripJack names them.
    assert path == "/oms/v1/air/book" and "paymentInfos" not in body
    assert body["travellerInfo"] == [{"ti": "Ms", "pt": "ADULT", "fN": "Asha", "lN": "Rao"}]
    assert body["deliveryInfo"] == {"emails": ["test@example.com"], "contacts": ["+919500112233"]}

    got = (await client.get("/flights/bookings/TJS100", headers=staff)).json()
    assert got["status"] == "ON_HOLD" and got["pnrs"] == ["ABC123"] and got["total"] == 9200
    assert got["hold_deadlines"] == {"itemInfos.AIR.timeLimit": "2026-10-28T22:00:00"}

    confirmed = await client.post(
        "/flights/bookings/TJS100/confirm", json={"amount": 9200}, headers=staff
    )
    assert confirmed.status_code == 200
    assert [p for p, _ in sent[-2:]] == ["/oms/v1/air/fare-validate", "/oms/v1/air/confirm-book"]
    assert sent[-1][1] == {"bookingId": "TJS100", "paymentInfos": [{"amount": 9200}]}

    released = (
        await client.post("/flights/bookings/TJS100/release", json={}, headers=staff)
    ).json()
    # With no PNRs given, the booking's own are released.
    assert released["pnrs"] == ["ABC123"] and sent[-1] == (
        "/oms/v1/air/unhold",
        {"bookingId": "TJS100", "pnrs": ["ABC123"]},
    )


async def test_an_instant_booking_pays_tripjacks_total_and_is_never_sent_twice(
    client, admin, monkeypatch
):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(503, text="busy")

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(tripjack_flights, "_client", lambda: http)
    r = await client.post("/flights/book", headers=auth(admin), json={
        "booking_id": "TJS100", "mode": "book", "amount": 9200, "travellers": [TRAVELLER],
        "email": "test@example.com", "phone": "+919500112233"})  # fmt: skip
    assert r.status_code == 502 and calls == ["/oms/v1/air/book"]  # no retry of a booking

    missing = await client.post("/flights/book", headers=auth(admin), json={
        "booking_id": "TJS100", "mode": "book", "travellers": [TRAVELLER],
        "email": "test@example.com", "phone": "+919500112233"})  # fmt: skip
    assert missing.status_code == 422


async def test_booking_is_refused_outside_the_test_environment_and_for_travellers(
    client, admin, traveler, monkeypatch
):
    sent: list = []
    upstream(monkeypatch, {"/fms/v1/review": REVIEW}, sent)
    assert (
        await client.post("/flights/review", json={"price_ids": ["p1"]}, headers=auth(traveler))
    ).status_code == 403
    monkeypatch.setattr(settings, "tripjack_api_url", "https://tripjack.com")
    r = await client.post("/flights/review", json={"price_ids": ["p1"]}, headers=auth(admin))
    assert r.status_code == 403 and "test environment" in r.json()["detail"] and sent == []
