"""OpenAI-compatible chat client for every LLM provider WishTrip uses.

Ollama (local, /v1) and OpenRouter (online) speak the same /chat/completions protocol, so one
client serves both; only the base URL, key, model names and the reasoning switch differ.
Moving from local to the server is `LLM_PROVIDER=openrouter` — no code change.
"""

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.ai.openrouter import AIUnavailableError
from app.core.config import settings

logger = logging.getLogger(__name__)

# "intent" | "planner" | "builder" | "reader" (reels);
# OpenRouter only: "transcribe" (audio in), "screen" (frames in)
Task = str


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    base_url: str
    api_key: str | None
    models: dict[Task, str]
    # Reasoning effort per task: "none" | "low" | "medium" | "high" | None (provider default).
    reasoning: dict[Task, str | None]


def provider_config(provider: str | None = None) -> ProviderConfig | None:
    """Resolve LLM_PROVIDER; None means no LLM (knowledge-base-only answers)."""
    provider = provider or settings.llm_provider
    if provider == "auto":
        provider = "openrouter" if settings.openrouter_api_key else "none"
    reasoning = {
        "intent": settings.intent_reasoning,
        "planner": settings.planner_reasoning,
        "builder": settings.trip_build_reasoning,
    }
    if provider == "openrouter":
        if not settings.openrouter_api_key:
            return None
        return ProviderConfig(
            "openrouter",
            settings.openrouter_base_url.rstrip("/"),
            settings.openrouter_api_key,
            {
                "intent": settings.intent_model,
                "planner": settings.chat_model,
                "builder": settings.trip_build_model or settings.chat_model,
                "transcribe": settings.reel_transcribe_model,
                "screen": settings.reel_screen_model,
                "reader": settings.reel_read_model or settings.chat_model,
            },
            reasoning,
        )
    if provider == "ollama":
        return ProviderConfig(
            "ollama",
            f"{settings.ollama_base_url.rstrip('/')}/v1",
            None,
            {
                "intent": settings.ollama_intent_model,
                "planner": settings.ollama_chat_model,
                "builder": settings.trip_build_model or settings.ollama_chat_model,
                "reader": settings.ollama_chat_model,
            },
            reasoning,
        )
    if provider == "none":
        return None
    raise ValueError(f"Unknown LLM_PROVIDER {provider!r}")


def reasoning_params(provider: str, effort: str | None) -> dict[str, Any]:
    """Each provider spells 'how much should the model think' differently."""
    if effort is None:
        return {}
    if provider == "ollama":
        return {"reasoning_effort": effort}
    # OpenRouter's unified reasoning parameter.
    if effort == "none":
        return {"reasoning": {"enabled": False}}
    return {"reasoning": {"effort": effort, "exclude": True}}


_FROM_SETTINGS: Any = object()


class LLMClient:
    def __init__(
        self,
        config: ProviderConfig | None = _FROM_SETTINGS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        # No argument → resolve LLM_PROVIDER from settings; an explicit None → no LLM at all.
        self.config = provider_config() if config is _FROM_SETTINGS else config
        self._transport = transport

    @property
    def enabled(self) -> bool:
        return self.config is not None

    @property
    def provider(self) -> str:
        return self.config.name if self.config else "none"

    def model_for(self, task: Task) -> str:
        if not self.config:
            raise AIUnavailableError("No LLM provider configured")
        if task not in self.config.models:
            raise AIUnavailableError(f"{self.provider} has no model for {task!r}")
        return self.config.models[task]

    def supports(self, task: Task) -> bool:
        return self.config is not None and task in self.config.models

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.config and self.config.api_key:
            headers["authorization"] = f"Bearer {self.config.api_key}"
        if self.provider == "openrouter":
            headers |= {"HTTP-Referer": "https://wishtrip.co", "X-Title": "WishTrip"}
        return headers

    async def chat(
        self,
        task: Task,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.4,
        json_mode: bool = False,
        # None: no limit of ours, the model's own maximum.
        max_tokens: int | None = 1500,
        timeout: float = 120,
    ) -> str:
        if not self.config:
            raise AIUnavailableError("No LLM provider configured")
        payload: dict[str, Any] = {
            "model": self.model_for(task),
            "messages": messages,
            "temperature": temperature,
            **({"max_tokens": max_tokens} if max_tokens else {}),
            **reasoning_params(self.provider, self.config.reasoning.get(task)),
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        response = await self._post(payload, timeout)
        if response.status_code == 400 and "reason" in response.text.lower():
            # Some models refuse to change reasoning; retry with the provider default.
            logger.info("Retrying %s without reasoning settings", payload["model"])
            payload.pop("reasoning", None)
            payload.pop("reasoning_effort", None)
            response = await self._post(payload, timeout)
        if response.status_code >= 400:
            raise AIUnavailableError(
                f"{self.provider} {response.status_code}: {response.text[:300]}"
            )
        data = response.json()
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError) as exc:
            raise AIUnavailableError(f"Unexpected {self.provider} response: {data}") from exc

    async def _post(self, payload: dict[str, Any], timeout: float = 120) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
                return await client.post(
                    f"{self.config.base_url}/chat/completions",
                    json=payload,
                    headers=self._headers(),
                )
        except httpx.HTTPError as exc:
            raise AIUnavailableError(f"{self.provider} unreachable: {exc}") from exc
