"""OpenRouter embeddings endpoint (chat goes through app.ai.llm.LLMClient)."""

from typing import Any

import httpx

from app.core.config import settings


class AIUnavailableError(RuntimeError):
    pass


class OpenRouterClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.api_key = api_key or settings.openrouter_api_key
        self.base_url = (base_url or settings.openrouter_base_url).rstrip("/")

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise AIUnavailableError("OPENROUTER_API_KEY is not configured")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://wishtrip.local",
            "X-Title": "WishTrip",
        }

    async def _post(self, path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{self.base_url}{path}", json=payload, headers=self._headers()
            )
        if response.status_code >= 400:
            raise AIUnavailableError(f"OpenRouter {response.status_code}: {response.text[:300]}")
        return response.json()

    async def embed(self, model: str, texts: list[str], dimensions: int) -> list[list[float]]:
        payload = {"model": model, "input": texts, "dimensions": dimensions}
        data = await self._post("/embeddings", payload, timeout=60)
        rows = sorted(data["data"], key=lambda row: row["index"])
        return [row["embedding"] for row in rows]
