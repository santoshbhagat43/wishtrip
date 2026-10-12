"""Single entry point for every AI call in WishTrip.

Application code asks for a *task* ("intent", "planner", "embedding"); the orchestrator
decides which model serves it. Swapping models is a config change, not a code change.
"""

import json
import logging
import re
from typing import Any

from app.ai.embeddings import Embedder, EmbedKind, get_embedder
from app.ai.llm import LLMClient

logger = logging.getLogger(__name__)


class AIOrchestrator:
    def __init__(self, client: LLMClient | None = None, embedder: Embedder | None = None) -> None:
        self.client = client or LLMClient()
        self.embedder = embedder or get_embedder()
        # One orchestrator per request: the same query text is embedded once, not once per
        # city and per retrieval step (a Kerala question used to embed it 10 times).
        self._query_cache: dict[str, list[float]] = {}

    @property
    def enabled(self) -> bool:
        return self.client.enabled

    def model_for(self, task: str) -> str:
        return self.client.model_for(task)

    async def embed(self, texts: list[str], kind: EmbedKind = "document") -> list[list[float]]:
        return await self.embedder.embed(texts, kind)

    async def embed_query(self, text: str) -> list[float]:
        if text not in self._query_cache:
            self._query_cache[text] = (await self.embed([text], "query"))[0]
        return self._query_cache[text]

    async def complete(self, task: str, messages: list[dict[str, str]], **kwargs: Any) -> str:
        return await self.client.chat(task, messages, **kwargs)

    async def complete_json(
        self, task: str, messages: list[dict[str, str]], timeout: float | None = None
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"json_mode": True, "temperature": 0.1, "max_tokens": 800}
        if timeout is not None:
            kwargs["timeout"] = timeout
        raw = await self.complete(task, messages, **kwargs)
        return parse_json_object(raw)


def parse_json_object(raw: str) -> dict[str, Any]:
    """Models sometimes wrap JSON in prose or fences; pull out the first object."""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise ValueError(f"Model did not return JSON: {raw[:200]}") from None
        parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("Model returned JSON that is not an object")
    return parsed


def get_orchestrator() -> AIOrchestrator:
    return AIOrchestrator()
