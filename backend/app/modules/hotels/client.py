"""TripJack Hotel API v3 client (search side only: content, listing, pricing)."""

import uuid
from typing import Any

from app.core.config import settings
from app.modules.tripjack.http import TripJackError, TripJackHTTP, TripJackNotConfigured

__all__ = ["TripJackError", "TripJackHotels", "TripJackNotConfigured", "tripjack_hotels"]

# 6514 SUPPLIER_UNAVAILABLE, 6515 SUPPLIER_TIMEOUT, 6516 INTERNAL_ERROR: retried with backoff.
# Not retried: 6502 / 6506 (session expired, option sold out): the traveller must search again.
_RETRYABLE = {"6514", "6515", "6516", "SUPPLIER_UNAVAILABLE", "SUPPLIER_TIMEOUT", "INTERNAL_ERROR"}
_NOT_RETRIED = {"6502", "6506", "SEARCH_SESSION_EXPIRED", "OPTION_SOLD_OUT"}


def new_correlation_id() -> str:
    return uuid.uuid4().hex[:22]


class TripJackHotels(TripJackHTTP):
    def api_key(self) -> str | None:
        return settings.tripjack_api_key

    def read_error(self, body: Any, status_code: int, text: str) -> TripJackError | None:
        """Errors arrive as HTTP 200 with an `error` envelope, so the body is read, not the
        status."""
        err = body.get("error") if isinstance(body, dict) else None
        ok = isinstance(body, dict) and (body.get("status") or {}).get("success", True)
        if 200 <= status_code < 300 and ok and not err:
            return None
        # No rooms for those dates comes back as success:false with an empty `options` list and
        # no error. That is an answer (nothing available), not a supplier failure.
        if (
            200 <= status_code < 300
            and not err
            and isinstance(body, dict)
            and "options" in body
            and not body["options"]
        ):
            return None
        code = str((err or {}).get("code") or status_code)
        message = (err or {}).get("message") or text[:200]
        retry = code in _RETRYABLE or (status_code >= 500 and code not in _NOT_RETRIED)
        return TripJackError(code, message, (err or {}).get("requestId", ""), retry)

    # ---- static content (synced into our database; never called per search) ----

    async def nationalities(self) -> list[dict]:
        url = f"{settings.tripjack_api_url}/hms/v3/nationality-info"
        return (await self._request("GET", url)).get("nationalityInfos", [])

    async def countries(self) -> list[str]:
        url = f"{settings.tripjack_search_url}/hms/v3/content/fetch-countries"
        return (await self._request("GET", url)).get("hotelCountries", [])

    async def city_regions(self, cursor: str | None = None, limit: int = 2000) -> dict:
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        url = f"{settings.tripjack_search_url}/hms/v3/content/fetch-city-regionIds"
        return await self._request("GET", url, params=params)

    async def hotel_mapping(
        self, *, region_ids: list[str] | None = None, country: str | None = None,
        page: int = 0, size: int = 2000,
    ) -> dict:
        body: dict[str, Any] = {"page": page, "size": size}
        if region_ids:
            body["regionIds"] = region_ids
        if country:
            body["countryName"] = country
        url = f"{settings.tripjack_search_url}/hms/v3/content/fetch-hotel-mapping"
        return await self._request("POST", url, json=body)

    async def hotel_content(self, hotel_ids: list[str]) -> list[dict]:
        url = f"{settings.tripjack_search_url}/hms/v3/content/fetch-hotel-content"
        body = await self._request("POST", url, json={"hotelIds": hotel_ids[:100]})
        return body.get("hotels", [])

    # ---- live (prices and availability) ----

    async def listing(
        self, *, hids: list[str], check_in: str, check_out: str, rooms: list[dict],
        correlation_id: str, nationality: str | None = None, currency: str | None = None,
    ) -> list[dict]:
        body = {
            "checkIn": check_in,
            "checkOut": check_out,
            "rooms": rooms,
            "currency": currency or settings.tripjack_currency,
            "correlationId": correlation_id,
            "nationality": nationality or settings.tripjack_nationality,
            "timeoutMs": settings.tripjack_request_timeout_ms,
            "hids": [int(h) for h in hids[:100]],
        }
        url = f"{settings.tripjack_search_url}/hms/v3/hotel/listing"
        return (await self._request("POST", url, json=body)).get("hotels", [])

    async def pricing(
        self, *, hid: str, check_in: str, check_out: str, rooms: list[dict],
        correlation_id: str, nationality: str | None = None, currency: str | None = None,
    ) -> dict:
        body = {
            "correlationId": correlation_id,
            "hid": hid,
            "checkIn": check_in,
            "checkOut": check_out,
            "rooms": rooms,
            "currency": currency or settings.tripjack_currency,
            "nationality": nationality or settings.tripjack_nationality,
            "timeoutMs": settings.tripjack_request_timeout_ms,
        }
        url = f"{settings.tripjack_search_url}/hms/v3/hotel/pricing"
        return await self._request("POST", url, json=body)


tripjack_hotels = TripJackHotels()
