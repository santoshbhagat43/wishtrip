"""Questions get direct answers (no day plan); destinations search every one of their cities."""

import json

import pytest

from app.ai.embeddings import HashingEmbedder
from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.db.session import SessionLocal
from app.main import app
from app.modules.chat import pipeline
from app.modules.chat.intent import Intent
from tests.conftest import auth


class ScriptedPlanner:
    """Fake LLM: fixed intent, and a planner that always returns a 2-day plan."""

    enabled, provider = True, "test"

    def __init__(self, intent: str, destination: str | None = "London"):
        self.intent, self.destination, self.calls = intent, destination, []

    def model_for(self, task):
        return f"fake-{task}"

    async def chat(self, task, messages, **kwargs):
        self.calls.append((task, messages, kwargs))
        if task == "intent":
            return json.dumps({"intent": self.intent, "destination": self.destination})
        return json.dumps(
            {
                "reply": "Here you go [K1].",
                "suggestions": [
                    {
                        "kb_ref": "K1",
                        "name": "x",
                        "type": "attraction",
                        "day": 1,
                        "time_of_day": "morning",
                    },
                    {"kb_ref": "K2", "name": "y", "type": "attraction", "day": 2},
                ],
            }
        )


async def chat_once(client, user, planner, text):
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(
        client=planner, embedder=HashingEmbedder()
    )
    try:
        chat = (await client.post("/chat/sessions", headers=auth(user))).json()
        r = await client.post(
            f"/chat/sessions/{chat['id']}/messages", json={"content": text}, headers=auth(user)
        )
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    return r.json()["assistant_message"]


def planner_calls(planner):
    return [c for c in planner.calls if c[0] == "planner"]


@pytest.mark.parametrize("intent", ["ask_info", "recommend"])
async def test_questions_get_a_direct_answer_not_a_day_plan(client, traveler, london, intent):
    planner = ScriptedPlanner(intent)
    msg = await chat_once(client, traveler, planner, "Is London good for bridges?")
    calls = planner_calls(planner)
    assert len(calls) == 1  # no plan-check rewrite
    system = calls[0][1][0]["content"]
    assert "do NOT write a day-by-day itinerary" in system
    assert calls[0][2]["max_tokens"] == 900
    assert msg["itinerary"] == [] and msg["feasibility"] is None
    assert all(
        s["day"] is None for s in msg["suggestions"]
    )  # days stripped even if the model adds them
    assert msg["sources"]  # still grounded in the knowledge base


@pytest.mark.parametrize("intent", ["plan_trip", "modify_plan"])
async def test_plans_still_get_a_checked_itinerary(client, traveler, london, intent):
    planner = ScriptedPlanner(intent)
    msg = await chat_once(client, traveler, planner, "Plan 2 days in London")
    system = planner_calls(planner)[0][1][0]["content"]
    assert "COMPLETE day-by-day itinerary" in system  # the planner prompt, not the answer one
    assert msg["feasibility"] is not None and msg["itinerary"]


async def test_small_talk_skips_retrieval(client, traveler, london):
    planner = ScriptedPlanner("smalltalk", destination=None)
    msg = await chat_once(client, traveler, planner, "hello!")
    assert msg["sources"] == [] and msg["grounding"] == "general"
    assert msg["feasibility"] is None


async def test_every_city_of_a_destination_is_searched(client, editor, traveler):
    """Used to stop at 6 cities: a 7-city region (like Japan) lost its 7th city entirely."""
    h = auth(editor)
    country = (
        await client.post(
            "/admin/locations",
            json={"type": "country", "name": "Sevenland", "status": "published"},
            headers=h,
        )
    ).json()
    for n in range(1, 8):
        city = (
            await client.post(
                "/admin/locations",
                json={
                    "type": "city",
                    "name": f"City {n}",
                    "parent_id": country["id"],
                    "status": "published",
                    "region": "Seven Coast",
                },
                headers=h,
            )
        ).json()
        for k in range(3):
            await client.post(
                "/admin/locations",
                json={
                    "type": "attraction",
                    "name": f"Museum {n}-{k}",
                    "parent_id": city["id"],
                    "status": "published",
                    "summary": "an ordinary museum",
                },
                headers=h,
            )
    city7 = city
    await client.post(
        "/admin/locations",
        json={
            "type": "experience",
            "name": "Glacier kayak at dawn",
            "parent_id": city7["id"],
            "status": "published",
            "summary": "kayak among glaciers at dawn",
        },
        headers=h,
    )

    async with SessionLocal() as session:
        for destination in ("Seven Coast", "Sevenland"):  # region and country
            _, items = await pipeline.retrieve(
                session,
                AIOrchestrator(embedder=HashingEmbedder()),
                traveler.id,
                "glacier kayak",
                Intent(intent="recommend", search_query="glacier kayak at dawn"),
                {"destination": destination},
            )
            names = [i.location.name for i in items]
            assert "Glacier kayak at dawn" in names, (destination, names)
            # Spread across cities: no single city fills the context.
            cities = [i.location.parent_id for i in items]
            assert max(cities.count(c) for c in set(cities)) <= 3
