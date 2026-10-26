"""The record of every TripJack call: what we sent, what TripJack answered, readable by staff."""

import json

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.hotels.client import tripjack_hotels
from app.modules.tripjack import cache, trace
from app.modules.tripjack.models import TripJackLog
from tests.conftest import auth

KEY = "tj-secret-key-for-tests-0123456789"


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
    monkeypatch.setattr(settings, "tripjack_api_key", KEY)
    monkeypatch.setattr(settings, "tripjack_search_url", "https://apitest-hms.tripjack.com")
    monkeypatch.setattr(settings, "tripjack_api_url", "https://apitest.tripjack.com")


def upstream(monkeypatch, handler):
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler), headers={"apikey": KEY})
    monkeypatch.setattr(tripjack_hotels, "_client", lambda: http)


LISTING = {"status": {"success": True}, "hotels": [{"hotelId": "1", "name": "La Estoria, Goa"}]}


async def search(**extra):
    return await tripjack_hotels.listing(
        hids=["1"], check_in="2026-12-01", check_out="2026-12-03", rooms=[{"adults": 2}],
        correlation_id="c1", **extra,
    )  # fmt: skip


async def rows():
    async with SessionLocal() as session:
        return list((await session.scalars(select(TripJackLog).order_by(TripJackLog.created_at))))


async def test_a_call_is_logged_with_what_was_sent_and_what_came_back(monkeypatch):
    upstream(monkeypatch, lambda r: httpx.Response(200, json=LISTING))
    trace.start()
    await search()
    [row] = await rows()
    assert (row.product, row.method, row.path) == ("hotels", "POST", "/hms/v3/hotel/listing")
    assert row.url == "https://apitest-hms.tripjack.com/hms/v3/hotel/listing"
    assert row.request_body["checkIn"] == "2026-12-01" and row.request_body["hids"] == [1]
    assert json.loads(row.response_body) == LISTING
    assert row.status == 200 and row.ok and row.ms >= 0 and row.response_bytes > 20
    assert row.trace_id and row.environment.startswith("UAT")
    assert row.request_headers["apikey"] == "…6789" and KEY not in json.dumps(row.request_headers)


async def test_a_failed_call_is_logged_with_why(monkeypatch):
    err = {"status": {"success": False}, "error": {"code": "6535", "message": "price changed"}}
    upstream(monkeypatch, lambda r: httpx.Response(200, json=err))
    trace.start()
    with pytest.raises(Exception, match="6535"):
        await search()
    [row] = await rows()
    assert not row.ok and "6535" in row.error and "price changed" in row.response_body


async def test_personal_details_and_long_answers_are_handled(monkeypatch):
    from app.modules.tripjack import logs

    assert logs.redact({"name": "A", "passportNumber": "X1", "contact": {"email": "a@b.c", "n": 1}}) == {
        "name": "A", "passportNumber": "[redacted]", "contact": {"email": "[redacted]", "n": 1}
    }  # fmt: skip
    monkeypatch.setattr(settings, "tripjack_log_body_bytes", 50)
    upstream(monkeypatch, lambda r: httpx.Response(200, json={**LISTING, "pad": "x" * 500}))
    trace.start()
    await search()
    [row] = await rows()
    assert row.response_truncated and len(row.response_body) == 50 and row.response_bytes > 500


async def test_staff_read_the_log_filter_it_and_export_it(client, admin, monkeypatch):
    upstream(monkeypatch, lambda r: httpx.Response(200, json=LISTING))
    trace.start()
    await search()
    staff = auth(admin)

    listed = (await client.get("/tripjack/logs", headers=staff)).json()
    assert listed["total"] == 1 and "response_body" not in listed["items"][0]
    item = listed["items"][0]
    assert item["path"] == "/hms/v3/hotel/listing" and item["status"] == 200

    detail = (await client.get(f"/tripjack/logs/{item['id']}", headers=staff)).json()
    assert detail["request_body"]["rooms"] == [{"adults": 2}] and "La Estoria" in detail["response_body"]

    for query, expected in (
        ({"product": "flights"}, 0), ({"product": "hotels"}, 1), ({"outcome": "failed"}, 0),
        ({"outcome": "ok"}, 1), ({"q": "La Estoria"}, 1), ({"q": "nothing like this"}, 0),
    ):  # fmt: skip
        got = (await client.get("/tripjack/logs", params=query, headers=staff)).json()
        assert got["total"] == expected, query

    text = (await client.get("/tripjack/logs/export", headers=staff)).text
    assert "POST https://apitest-hms.tripjack.com/hms/v3/hotel/listing" in text
    assert "--- REQUEST" in text and "--- RESPONSE (200)" in text and "La Estoria, Goa" in text
    assert KEY not in text and "apikey: …6789" in text

    assert (await client.get("/tripjack/logs/00000000-0000-0000-0000-000000000000", headers=staff)).status_code == 404
    assert (await client.get("/tripjack/logs")).status_code == 401
