"""Intent understanding: model-output validation, keyword fallback, trip state, destinations.

The fallback cases use phrasings that are NOT in the benchmark (app/scripts/eval_intent.py),
so they check that it generalises rather than memorising the benchmark."""

import json

import pytest

from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator
from app.db.session import SessionLocal
from app.modules.chat.intent import _clean, heuristic_intent, understand
from app.modules.chat.pipeline import merge_state, resolve_destination
from tests.conftest import auth

DESTINATIONS = ["London", "Paris", "Kerala", "Dharamshala", "Krabi", "Goa", "United Kingdom"]
TAGS = ["Street food", "Scenic views", "History", "Nightlife"]


# Validating what a model returns -----------------------------------------------------------


def test_clean_rejects_values_outside_the_contract():
    intent = _clean(
        {
            "intent": "book_flight",
            "destination": "",
            "duration_days": 400,
            "start_date": "next tuesday",
            "companions": "coworkers",
            "budget_level": 9,
            "energy_level": "3",
            "preferred_times": ["evening", "brunch"],
            "interests": ["Street Food"] + [f"x{i}" for i in range(20)],
            "location_types": ["city", "restaurant", "spaceport"],
            "search_query": None,
        },
        "fallback query",
    )
    assert intent.intent == "recommend"
    assert intent.destination is None
    assert intent.duration_days is None
    assert intent.start_date is None
    assert intent.companions is None
    assert intent.budget_level is None
    assert intent.energy_level == 3  # numeric strings are accepted
    assert intent.preferred_times == ["evening"]
    assert intent.interests[0] == "street food" and len(intent.interests) == 8
    assert intent.location_types == ["restaurant"]
    assert intent.search_query == "fallback query"


def test_clean_keeps_a_valid_iso_start_date():
    assert _clean({"start_date": "2026-11-02"}, "q").start_date == "2026-11-02"


# Keyword fallback (no LLM) — held-out phrasings ------------------------------------------

CASES = [
    (
        "Two weeks in Goa backpacking with mates",
        {"destination": "Goa", "duration_days": 14, "companions": "friends", "budget_level": 1},
    ),
    ("a long weekend in Paris with my fiance", {"duration_days": 2, "companions": "couple"}),
    ("3 chilled-out nights in Krabi", {"destination": "Krabi", "duration_days": 3}),
    ("ten action-packed days of trekking in Dharamshala", {"duration_days": 10, "energy_level": 4}),
    (
        "a fortnight in Kerala for grandma and grandpa",
        {"duration_days": 14, "companions": "seniors"},
    ),
    ("London with our toddler, somewhere gentle", {"companions": "family", "energy_level": 2}),
    ("my mum is in a wheelchair, what can we see in London?", {"energy_level": 1}),
    ("I'm going alone to Paris", {"companions": "solo", "destination": "Paris"}),
    ("is Goa good in the monsoon?", {"intent": "ask_info", "destination": "Goa"}),
    ("How far is the airport from the city?", {"intent": "ask_info"}),
    ("swap the museum for something outdoors", {"intent": "modify_plan"}),
    ("can you drop day 3 and make it easier", {"intent": "modify_plan", "energy_level": 2}),
    ("hey there", {"intent": "smalltalk"}),
    ("thanks!", {"intent": "smalltalk"}),
    ("splurge-worthy hotels in London", {"budget_level": 4, "location_types": ["hotel"]}),
    ("best cafes and restaurants in Paris for dinner", {"location_types": ["restaurant"]}),
    ("street food and nightlife in London", {"interests": ["street food", "nightlife"]}),
    ("sunrise and evening walks", {"preferred_times": ["evening"], "location_types": ["route"]}),
    ("What should we do in Paris?", {"location_types": []}),  # "do" is not a place type
    ("this season looks busy", {"companions": None}),  # "son" inside "season" isn't a child
    ("Plan something in Atlantis", {"destination": "Atlantis", "intent": "plan_trip"}),
    ("Planning a trip to the United Kingdom", {"destination": "United Kingdom"}),
]


@pytest.mark.parametrize(("message", "expected"), CASES, ids=[c[0][:40] for c in CASES])
def test_keyword_fallback(message, expected):
    intent = heuristic_intent(message, DESTINATIONS, TAGS).to_dict()
    for field, value in expected.items():
        actual = intent[field]
        if isinstance(value, list) and value:
            assert set(value) <= set(actual), (field, actual)
        else:
            assert actual == value, (field, actual)
    assert intent["source"] == "heuristic"


# Model path and failure fallbacks ---------------------------------------------------------


class ScriptedClient:
    enabled = True
    provider = "test"

    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.seen = reply, error, []

    def model_for(self, task):
        return "test-model"

    async def chat(self, task, messages, **kwargs):
        self.seen.append(messages)
        if self.error:
            raise self.error
        return self.reply


async def test_model_intent_is_used_and_sees_recent_history():
    client = ScriptedClient(
        json.dumps({"intent": "plan_trip", "destination": "Goa", "duration_days": 4})
    )
    history = [{"role": "user", "content": f"turn {i}"} for i in range(10)]
    intent = await understand(
        AIOrchestrator(client=client), "4 days in Goa", history, DESTINATIONS, TAGS
    )
    assert (intent.source, intent.destination, intent.duration_days) == ("model", "Goa", 4)
    sent = client.seen[0]
    assert sent[0]["role"] == "system" and "Goa" in sent[0]["content"]  # known destinations listed
    assert [m["content"] for m in sent[1:-1]] == [f"turn {i}" for i in range(4, 10)]  # last 6 turns


@pytest.mark.parametrize(
    "client",
    [
        ScriptedClient(error=AIUnavailableError("ollama down")),
        ScriptedClient(reply="Sure! I'd love to help you plan."),  # not JSON at all
    ],
)
async def test_model_failures_fall_back_to_keywords(client):
    intent = await understand(
        AIOrchestrator(client=client), "3 days in Goa with friends", [], DESTINATIONS, TAGS
    )
    assert intent.source == "heuristic"
    assert (intent.destination, intent.duration_days, intent.companions) == ("Goa", 3, "friends")


async def test_model_json_wrapped_in_prose_is_still_parsed():
    client = ScriptedClient(
        reply='Here you go:\n```json\n{"intent": "recommend", "destination": "Paris"}\n```'
    )
    intent = await understand(AIOrchestrator(client=client), "Paris?", [], DESTINATIONS, TAGS)
    assert (intent.source, intent.destination) == ("model", "Paris")


# Trip state across turns -----------------------------------------------------------------


def test_merge_state_keeps_context_and_lets_new_details_win():
    first = heuristic_intent("5 days in Goa with friends", DESTINATIONS, TAGS)
    state = merge_state({}, first)
    assert state == {"destination": "Goa", "duration_days": 5, "companions": "friends"}
    second = heuristic_intent(
        "actually make it a week, relaxed, evenings please", DESTINATIONS, TAGS
    )
    state = merge_state(state, second)
    assert state["destination"] == "Goa" and state["companions"] == "friends"  # kept
    assert state["duration_days"] == 7 and state["energy_level"] == 2  # updated
    assert state["preferred_times"] == ["evening"]
    assert merge_state(state, heuristic_intent("thanks!", DESTINATIONS, TAGS)) == state  # no wipe


# Destination resolution ------------------------------------------------------------------


async def test_destination_resolution(client, editor, london):
    h = auth(editor)
    await client.patch(
        f"/admin/locations/{london['city']['id']}",
        json={"aliases": ["Londres"], "region": "England"},
        headers=h,
    )
    async with SessionLocal() as session:
        for name in ("London", "london", "LONDON", "Londres", "London.", "'london'", "Lon"):
            found, ids = await resolve_destination(session, name)
            assert found is not None and found.name == "London", name
            assert ids == [found.id]
        region, region_ids = await resolve_destination(session, "England")
        assert region.name == "London" and len(region_ids) == 1
        country, country_ids = await resolve_destination(session, "United Kingdom")
        assert country.type.value == "country" and len(country_ids) == 1
        assert await resolve_destination(session, "Reykjavik") == (None, [])
        assert await resolve_destination(session, None) == (None, [])
        assert await resolve_destination(session, "...") == (None, [])
