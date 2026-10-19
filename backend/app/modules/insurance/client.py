"""TripJack TripSafe (travel insurance) v2 client: plan search only; booking is not wired yet."""

from typing import Any

from app.core.config import settings
from app.modules.tripjack.http import TripJackError, TripJackHTTP, TripJackNotConfigured

__all__ = ["TripJackInsurance", "TripJackError", "TripJackNotConfigured", "tripjack_insurance"]


class TripJackInsurance(TripJackHTTP):
    product = "insurance"

    def api_key(self) -> str | None:
        return settings.tripjack_insurance_api_key or settings.tripjack_api_key

    def excerpt(self, url: str, body: Any) -> dict | None:
        """Each plan's id, insurer and whole-trip premium as TripJack priced it."""
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict) or "productInfo" not in data:
            return None
        plans = data.get("productInfo") or []
        return {
            "searchId": data.get("searchId"),
            "count": len(plans),
            "plans": [
                {
                    "productId": p.get("productId"),
                    "insurer": p.get("insuranceProvider"),
                    "totalFare": (p.get("fareDetails") or {}).get("totalFare"),
                }
                for p in plans[:100]
            ],
        }

    def read_error(self, body: Any, status_code: int, text: str) -> TripJackError | None:
        """Business errors use {success: false, error: {code, message}}; a bad key is a raw
        JSON object with its own shape (401)."""
        if isinstance(body, dict) and body.get("success") is True and 200 <= status_code < 300:
            return None
        err = (body or {}).get("error") if isinstance(body, dict) else None
        if isinstance(err, dict):
            code, message = str(err.get("code") or status_code), err.get("message") or ""
        elif isinstance(body, dict):
            code = str(body.get("errCode") or body.get("status") or status_code)
            message = body.get("message") or body.get("error") or text[:200]
        else:
            code, message = str(status_code), text[:200]
        return TripJackError(code, str(message), retryable=status_code == 429 or status_code >= 500)

    async def search(self, body: dict) -> dict:
        url = f"{settings.tripjack_api_url}/insurance/v2/search"
        return (await self._request("POST", url, json=body)).get("data") or {}


tripjack_insurance = TripJackInsurance()
