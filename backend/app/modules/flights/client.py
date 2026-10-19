"""TripJack Flights API v2 client (search and fare rules only; booking is not wired yet)."""

from typing import Any

from app.core.config import settings
from app.modules.tripjack.http import TripJackError, TripJackHTTP, TripJackNotConfigured

__all__ = ["TripJackError", "TripJackFlights", "TripJackNotConfigured", "tripjack_flights"]


class TripJackFlights(TripJackHTTP):
    product = "flights"

    def api_key(self) -> str | None:
        return settings.tripjack_flight_api_key or settings.tripjack_api_key

    def excerpt(self, url: str, body: Any) -> dict | None:
        """Every fare id with the per-passenger base fare and taxes TripJack quoted."""
        if not isinstance(body, dict):
            return None
        if url.endswith("/fms/v1/air-search-all"):
            trips = (body.get("searchResult") or {}).get("tripInfos") or {}
            rows = []
            for journey, items in trips.items():
                for t in items or []:
                    segs = t.get("sI") or []
                    rows.append(
                        {
                            "journey": journey,
                            "flights": [
                                f"{((s.get('fD') or {}).get('aI') or {}).get('code', '')}"
                                f"{(s.get('fD') or {}).get('fN', '')}"
                                for s in segs
                            ],
                            "departs": segs[0].get("dt") if segs else None,
                            "fares": [
                                {
                                    "id": f.get("id"),
                                    "type": f.get("fareIdentifier"),
                                    "adult": {
                                        k: ((f.get("fd") or {}).get("ADULT") or {})
                                        .get("fC", {})
                                        .get(k)
                                        for k in ("BF", "TAF", "TF")
                                    },
                                }
                                for f in t.get("totalPriceList") or []
                            ],
                        }
                    )
            return {"count": len(rows), "trips": rows[:200]}
        if url.endswith("/fms/v2/farerule"):
            rules = body.get("fareRule") or {}
            return {
                "sectors": {
                    sector: {
                        kind: [
                            {"st": b.get("st"), "et": b.get("et"), "amount": b.get("amount")}
                            for b in bands or []
                        ]
                        for kind, bands in ((entry or {}).get("tfr") or {}).items()
                    }
                    for sector, entry in rules.items()
                    if isinstance(entry, dict)
                }
            }
        return None

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
