"""TripJack Flights API v2 client (search and fare rules only; booking is not wired yet)."""

from typing import Any

from app.core.config import settings
from app.modules.tripjack.http import TripJackError, TripJackHTTP, TripJackNotConfigured

__all__ = ["TripJackError", "TripJackFlights", "TripJackNotConfigured", "tripjack_flights"]


class TripJackFlights(TripJackHTTP):
    def api_key(self) -> str | None:
        return settings.tripjack_flight_api_key or settings.tripjack_api_key

    def read_error(self, body: Any, status_code: int, text: str) -> TripJackError | None:
        """Failures carry `status.success: false` and an `errors` list ({errCode, message})."""
        if isinstance(body, dict):
            status = body.get("status") or {}
            errors = body.get("errors") or []
            if 200 <= status_code < 300 and status.get("success", True) and not errors:
                return None
            first = errors[0] if errors else {}
            code = str(first.get("errCode") or status.get("httpStatus") or status_code)
            message = first.get("message") or first.get("details") or text[:200]
        else:
            code, message = str(status_code), text[:200]
        retry = status_code == 429 or status_code >= 500
        return TripJackError(code, message, retryable=retry)

    async def search(self, search_query: dict) -> dict:
        url = f"{settings.tripjack_api_url}/fms/v1/air-search-all"
        return await self._request("POST", url, json={"searchQuery": search_query})

    async def fare_rule(self, price_id: str) -> dict:
        url = f"{settings.tripjack_api_url}/fms/v2/farerule"
        return await self._request("POST", url, json={"flowType": "SEARCH", "id": price_id})


tripjack_flights = TripJackFlights()
