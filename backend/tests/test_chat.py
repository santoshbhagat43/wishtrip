import json
import re

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.main import app
from app.modules.chat.pipeline import ContextItem, validate
from app.modules.knowledge.models import Location, LocationType
from tests.conftest import auth


async def _chat(client, headers, *messages):
    chat = (await client.post("/chat/sessions", headers=headers)).json()
    turn = None
    for message in messages:
        r = await client.post(
            f"/chat/sessions/{chat['id']}/messages", json={"content": message}, headers=headers
        )
        assert r.status_code == 200, r.text
        turn = r.json()
    return chat, turn


async def test_fallback_chat_uses_knowledge_base(client, traveler, london):
    _, turn = await _chat(
        client, auth(traveler), "Plan 2 days in London with street food for my wife and me"
    )
    msg = turn["assistant_message"]
    assert msg["grounding"] == "knowledge_base"
    assert msg["model"] == "knowledge-base-fallback"
    assert msg["intent"]["destination"] == "London"
    assert msg["intent"]["companions"] == "couple"
    assert turn["session"]["state"]["duration_days"] == 2
    names = [s["name"] for s in msg["suggestions"]]
    assert "Borough Market Food Walk" in names
    assert all(s["from_knowledge_base"] for s in msg["suggestions"])


async def test_unknown_destination_is_general(client, traveler, london):
    _, turn = await _chat(client, auth(traveler), "Things to do in Atlantis, near the Thames?")
    msg = turn["assistant_message"]
    # "Thames" matches London places by keyword; they must not be offered for Atlantis.
    assert msg["intent"]["destination"] == "Atlantis"
    assert msg["grounding"] == "general"
    assert msg["sources"] == []


async def test_state_carries_across_turns(client, traveler, london):
    _, turn = await _chat(
        client, auth(traveler), "I want to visit London", "something relaxing in the evening"
    )
    state = turn["session"]["state"]
    assert state["destination"] == "London"
    assert state["preferred_times"] == ["evening"]


def test_validation_enforces_knowledge_base():
    loc = Location(
        id=__import__("uuid").uuid4(),
        name="Scenic Drive",
        type=LocationType.ROUTE,
        duration_minutes=240,
        price_note="",
        tips="Start before 8 am to beat the traffic.",
        tags=[],
    )
    items = [ContextItem(ref="K1", location=loc, city="London")]
    answer = {
        "reply": "Do the drive for £45 per person, and book a hotel at $200/night.",
        "suggestions": [
            {"kb_ref": "K1", "name": "drive", "type": "route", "duration_minutes": 30},
            {"kb_ref": None, "name": "The Ritz", "type": "hotel"},
            {"kb_ref": "K9", "name": "Ghost place", "type": "attraction"},
        ],
    }
    reply, suggestions, notes = validate(answer, items)
    assert "£45" not in reply and "$200" not in reply
    assert reply.count("(price not available yet)") == 2
    assert suggestions[0]["duration_minutes"] == 240 and suggestions[0]["price"] is None
    # Staff tips travel with the stop whatever the model wrote; general places have none.
    assert suggestions[0]["tip"] == "Start before 8 am to beat the traffic."
    assert suggestions[1]["tip"] is None
    assert suggestions[1]["is_placeholder"] and suggestions[1]["name"] == "Sample hotel option"
    assert not suggestions[2]["from_knowledge_base"]
    assert any("duration corrected" in n for n in notes)


class FakeClient:
    """Stands in for the LLM provider: returns canned intent and planner JSON."""

    enabled = True
    provider = "openrouter"
    MODELS = {"intent": "x-ai/grok-4.3", "planner": "x-ai/grok-4.7"}

    def __init__(self):
        self.calls = []

    def model_for(self, task):
        return self.MODELS[task]

    async def chat(self, task, messages, **kwargs):
        self.calls.append((self.MODELS[task], messages))
        if task == "intent":
            return json.dumps(
                {
                    "intent": "plan_trip",
                    "destination": "London",
                    "duration_days": 1,
                    "interests": ["street food"],
                    "search_query": "street food",
                }
            )
        return json.dumps(
            {
                "reply": "Start at Borough Market [K1]. Expect to spend €30.",
                "suggestions": [
                    {
                        "kb_ref": "K1",
                        "name": "Borough Market Food Walk",
                        "type": "experience",
                        "day": 1,
                        "time_of_day": "morning",
                        "duration_minutes": 60,
                        "why": "Food!",
                    }
                ],
                "follow_up_questions": ["Any dietary needs?"],
            }
        )


async def test_model_chat_is_grounded_and_validated(client, traveler, london):
    fake = FakeClient()
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=fake)
    try:
        _, turn = await _chat(client, auth(traveler), "One day of street food in London")
    finally:
        app.dependency_overrides.clear()
    msg = turn["assistant_message"]
    planner_context = fake.calls[-1][1][1]["content"]
    assert "Borough Market Food Walk" in planner_context  # KB was given to the model
    assert "Price: Pay per stall" in planner_context
    assert msg["model"] == "x-ai/grok-4.7"
    assert "€30" not in msg["content"]
    suggestion = msg["suggestions"][0]
    assert suggestion["duration_minutes"] == 120  # KB value wins over the model's 60
    assert suggestion["price"] == "Pay per stall"
    assert msg["follow_ups"] == ["Any dietary needs?"]


async def test_destination_aliases_resolve(client, editor, traveler, london):
    # Travelers say "Londres"; the knowledge base calls it London.
    await client.patch(
        f"/admin/locations/{london['city']['id']}",
        json={"aliases": ["Londres"]},
        headers=auth(editor),
    )
    _, turn = await _chat(client, auth(traveler), "3 days in Londres with street food")
    msg = turn["assistant_message"]
    assert msg["intent"]["destination"] == "Londres"
    assert msg["grounding"] == "knowledge_base"
    assert any(s["name"] == "Borough Market Food Walk" for s in msg["sources"])


def test_intent_never_narrows_to_container_types():
    from app.modules.chat.intent import _clean

    intent = _clean(
        {"intent": "plan_trip", "location_types": ["city", "country", "restaurant"]}, "x"
    )
    assert intent.location_types == ["restaurant"]


class OverloadingPlanner(FakeClient):
    """Plans three long stops into day 1 of a 2-day trip, then rewrites when asked."""

    async def chat(self, task, messages, **kwargs):
        self.calls.append((task, messages))
        if task == "intent":
            return json.dumps(
                {
                    "intent": "plan_trip",
                    "destination": "London",
                    "duration_days": 2,
                    "energy_level": 2,
                    "search_query": "london highlights",
                }
            )
        if "FINAL ITINERARY" in messages[0]["content"]:
            return "Rewritten plan: Day 1 Tower Bridge, Day 2 Borough Market [K1]."
        refs = {m: r for r, m in re.findall(r"\[(K\d+)\] ([^—]+?) —", messages[1]["content"])}
        return json.dumps(
            {
                "reply": "Day 1: everything!",
                "suggestions": [
                    {
                        "kb_ref": refs[name],
                        "name": name,
                        "type": "attraction",
                        "day": 1,
                        "time_of_day": None,
                    }
                    for name in ("Tower Bridge", "Borough Market Food Walk", "Thames Kayaking")
                    if name in refs
                ],
            }
        )


async def test_plan_check_repairs_and_rewrites_the_reply(client, traveler, london, monkeypatch):
    from app.core.config import settings

    # Pin the flag: this test is about the rewrite path, and a developer's .env must not
    # decide whether it runs. Its sibling below covers the note path with the flag off.
    monkeypatch.setattr(settings, "feasibility_rewrite", True)
    planner = OverloadingPlanner()
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=planner)
    try:
        _, turn = await _chat(client, auth(traveler), "Two relaxed days in London please")
    finally:
        app.dependency_overrides.clear()
    msg = turn["assistant_message"]
    assert msg["feasibility"]["status"] == "repaired"
    assert msg["feasibility"]["changes"]
    days = {d["day"]: d for d in msg["itinerary"]}
    assert set(days) == {1, 2}
    for d in days.values():
        assert d["activity_minutes"] + d["travel_minutes"] <= d["capacity_minutes"] == 360
        assert all(i["start"] and i["end"] for i in d["items"])
    assert msg["content"].startswith("Rewritten plan")
    assert "Reply rewritten to match the plan-check adjustments." in msg["validation_notes"]
    assert sum(1 for task, _ in planner.calls if task == "planner") == 2


async def test_plan_check_appends_a_note_when_rewrite_is_off(client, traveler, london, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "feasibility_rewrite", False)
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=OverloadingPlanner())
    try:
        _, turn = await _chat(client, auth(traveler), "Two relaxed days in London please")
    finally:
        app.dependency_overrides.clear()
    assert "**Plan check — adjusted so the trip works:**" in turn["assistant_message"]["content"]


async def test_profile_hard_constraints_apply_to_what_was_asked_too(client, traveler, london):
    # Search by meaning ranks the kayak first for this question; a family profile must still
    # keep a not-family-friendly place out of what the planner is given, not only out of the plan.
    h = auth(traveler)
    r = await client.put("/profiles/me", json={"companions": "family"}, headers=h)
    assert r.status_code == 200, r.text
    _, turn = await _chat(client, h, "Kayaking on the Thames in London")
    names = [s["name"] for s in turn["assistant_message"]["sources"]]
    assert names, "London places should still be offered"
    assert "Thames Kayaking" not in names


async def test_conversation_reads_question_then_answer(client, traveler, london):
    # Both messages of a turn are saved together; the question must still come first.
    h = auth(traveler)
    chat, _ = await _chat(client, h, "Plan 2 days in London", "make it 3 days")
    detail = (await client.get(f"/chat/sessions/{chat['id']}", headers=h)).json()
    roles = [m["role"] for m in detail["messages"]]
    assert roles == ["user", "assistant", "user", "assistant"]
    assert detail["messages"][0]["content"] == "Plan 2 days in London"
