"""Live checks against a real LLM (local Ollama by default). Skipped unless LIVE_LLM=1.

LIVE_LLM=1 uv run pytest tests/test_live_llm.py -v
LIVE_LLM=1 LIVE_LLM_PROVIDER=openrouter uv run pytest tests/test_live_llm.py -v
"""

import os

import pytest

from app.ai.llm import LLMClient, provider_config
from app.ai.orchestrator import AIOrchestrator
from app.modules.chat.intent import understand
from app.scripts.eval_intent import CASES, matches

pytestmark = pytest.mark.skipif(os.environ.get("LIVE_LLM") != "1", reason="set LIVE_LLM=1 to run")

DESTINATIONS = [
    "Kerala",
    "Goa",
    "Bangkok",
    "Kyoto",
    "Munnar",
    "Dharamshala",
    "Phuket",
    "Japan",
    "Chiang Mai",
    "Tokyo",
    "McLeod Ganj",
    "Munnar tea hills",
]
TAGS = ["Street food", "Scenic views", "Nature", "Culture", "Beach", "Spiritual"]


@pytest.fixture(scope="module")
def ai():
    cfg = provider_config(os.environ.get("LIVE_LLM_PROVIDER", "ollama"))
    if cfg is None:
        pytest.skip("provider not configured")
    return AIOrchestrator(client=LLMClient(cfg))


@pytest.mark.parametrize(("message", "expected"), CASES, ids=[c[0][:40] for c in CASES])
async def test_live_intent(ai, message, expected):
    intent = (await understand(ai, message, [], DESTINATIONS, TAGS)).to_dict()
    assert intent["source"] == "model", "the model call failed and fell back to keywords"
    misses = {k: intent.get(k) for k, v in expected.items() if not matches(v, intent.get(k))}
    assert not misses, misses


def _next(month: int, day: int) -> str:
    from datetime import date

    today = date.today()
    found = date(today.year, month, day)
    return (found if found >= today else found.replace(year=today.year + 1)).isoformat()


# Messages designed to tempt the model into guessing, plus typos and take-backs.
ROBUSTNESS = [
    ("5 days in Kerela with my wife", {"destination": "Kerala", "duration_days": 5}),
    ("I'd love Bangkock for the street food", {"destination": "Bangkok"}),
    ("Plan Goa with friends", {"destination": "Goa", "duration_days": None}),
    ("somewhere warm with beaches, any ideas?", {"destination": None}),
    ("4 days in Goa from 12 Nov", {"duration_days": 4, "start_date": _next(11, 12)}),
    ("actually our dates are flexible now", {"cleared_fields": ["start_date"]}),
]


@pytest.mark.parametrize(("message", "expected"), ROBUSTNESS, ids=[c[0][:40] for c in ROBUSTNESS])
async def test_live_intent_robustness(ai, message, expected):
    intent = (await understand(ai, message, [], DESTINATIONS + ["Bangkok"], TAGS)).to_dict()
    assert intent["source"] == "model"
    for field, value in expected.items():
        if isinstance(value, list):
            assert set(value) <= set(intent[field]), (field, intent[field], intent["corrections"])
        else:
            assert intent[field] == value, (field, intent[field], intent["corrections"])
