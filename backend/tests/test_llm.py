import json

import httpx
import pytest

from app.ai.llm import LLMClient, ProviderConfig, provider_config, reasoning_params
from app.ai.openrouter import AIUnavailableError
from app.core.config import settings


def transport(seen: list, responses: list[httpx.Response] | None = None):
    queue = list(responses or [])

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(
            {
                "url": str(request.url),
                "headers": dict(request.headers),
                "body": json.loads(request.content),
            }
        )
        if queue:
            return queue.pop(0)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}}]})

    return httpx.MockTransport(handler)


def config(name: str) -> ProviderConfig:
    return provider_config(name)


def test_provider_resolution(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "llm_provider", "auto")
    assert provider_config() is None  # no key → knowledge-base-only answers
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-test")
    assert provider_config().name == "openrouter"
    monkeypatch.setattr(settings, "llm_provider", "ollama")
    cfg = provider_config()
    assert cfg.name == "ollama"
    assert cfg.base_url.endswith("/v1")
    assert cfg.models == {
        "intent": settings.ollama_intent_model,
        "planner": settings.ollama_chat_model,
        "builder": settings.ollama_chat_model,  # the trip builder: the chat model unless set apart
        "reader": settings.ollama_chat_model,  # reels are read by the chat model locally
    }
    monkeypatch.setattr(settings, "llm_provider", "openrouter")
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    assert provider_config() is None  # openrouter without a key is not usable


def test_reasoning_params_per_provider():
    assert reasoning_params("ollama", "none") == {"reasoning_effort": "none"}
    assert reasoning_params("openrouter", "none") == {"reasoning": {"enabled": False}}
    assert reasoning_params("openrouter", "low") == {
        "reasoning": {"effort": "low", "exclude": True}
    }
    assert reasoning_params("ollama", None) == {}


async def test_ollama_request_shape():
    seen: list = []
    client = LLMClient(config("ollama"), transport=transport(seen))
    out = await client.chat("intent", [{"role": "user", "content": "hi"}], json_mode=True)
    assert out == '{"ok": true}'
    req = seen[0]
    assert req["url"] == f"{settings.ollama_base_url}/v1/chat/completions"
    assert "authorization" not in req["headers"]
    assert req["body"]["model"] == settings.ollama_intent_model
    assert req["body"]["response_format"] == {"type": "json_object"}
    assert req["body"]["reasoning_effort"] == "none"


async def test_openrouter_request_shape(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-test")
    monkeypatch.setattr(settings, "planner_reasoning", None)  # whatever the local .env sets
    seen: list = []
    client = LLMClient(config("openrouter"), transport=transport(seen))
    await client.chat("planner", [{"role": "user", "content": "hi"}])
    await client.chat("intent", [{"role": "user", "content": "hi"}], json_mode=True)
    planner, intent = seen
    assert planner["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert planner["headers"]["authorization"] == "Bearer sk-test"
    assert planner["headers"]["x-title"] == "WishTrip"
    assert planner["body"]["model"] == settings.chat_model
    assert "reasoning" not in planner["body"]  # planner uses the model's default
    assert intent["body"]["model"] == settings.intent_model
    assert intent["body"]["reasoning"] == {"enabled": False}


async def test_retries_without_reasoning_when_model_requires_it(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-test")
    seen: list = []
    refused = httpx.Response(
        400, json={"error": {"message": "Reasoning is mandatory for this endpoint"}}
    )
    client = LLMClient(config("openrouter"), transport=transport(seen, [refused]))
    assert await client.chat("intent", [{"role": "user", "content": "hi"}]) == '{"ok": true}'
    assert "reasoning" in seen[0]["body"]
    assert "reasoning" not in seen[1]["body"]


async def test_errors_and_disabled_client():
    with pytest.raises(AIUnavailableError):
        await LLMClient(config("none")).chat("intent", [])
    seen: list = []
    broken = LLMClient(
        config("ollama"), transport=transport(seen, [httpx.Response(500, text="boom")])
    )
    with pytest.raises(AIUnavailableError, match="500"):
        await broken.chat("intent", [])


def test_explicit_none_disables_the_llm_even_when_settings_enable_one(monkeypatch):
    """Regression: LLMClient(None) once fell back to settings and silently called the model."""
    monkeypatch.setattr(settings, "llm_provider", "ollama")
    assert LLMClient().enabled is True
    assert LLMClient(None).enabled is False
