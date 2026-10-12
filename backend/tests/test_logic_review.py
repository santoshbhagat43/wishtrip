"""Regression tests for issues found in the logic review (each was reproduced before fixing)."""

import uuid

import pytest

from app.ai.embeddings import HashingEmbedder
from app.ai.orchestrator import AIOrchestrator
from app.db.session import SessionLocal
from app.modules.chat import pipeline
from app.modules.chat.intent import Intent, heuristic_intent, reconcile
from app.modules.chat.pipeline import (
    PRICE_PATTERN,
    normalize_day,
    normalize_type,
    tag_matches,
    validate,
)
from app.modules.itinerary.feasibility import Constraints, check_and_repair
from app.modules.knowledge.models import Location, LocationType
from tests.conftest import auth

# Model output that used to crash or slip through ---------------------------------------


def test_day_zero_from_the_model_no_longer_crashes_the_chat():
    _, s, _ = validate(
        {
            "suggestions": [
                {"name": "X", "type": "attraction", "day": 0},
                {"name": "Y", "type": "attraction", "day": 1},
            ]
        },
        [],
    )
    assert [x["day"] for x in s] == [None, 1]
    check_and_repair(s, {}, [], {}, Constraints())  # used to raise KeyError: 0


@pytest.mark.parametrize(
    ("value", "expected"),
    [(True, None), (0, None), (-1, None), (61, None), ("3", 3), (2, 2), ("two", None)],
)
def test_day_numbers(value, expected):
    assert normalize_day(value) == expected


@pytest.mark.parametrize(
    "kind", ["Hotel", "resort", "Homestay", "boutique hotel", "Flight", "Airline", "houseboat stay"]
)
def test_invented_hotels_and_flights_become_placeholders_whatever_the_spelling(kind):
    _, s, _ = validate(
        {"suggestions": [{"kb_ref": None, "name": "The Leela Palace", "type": kind}]}, []
    )
    assert s[0]["is_placeholder"] and s[0]["name"].startswith("Sample ")


def test_type_normalisation_keeps_real_types():
    assert normalize_type("Attraction") == "attraction"
    assert normalize_type("Café") == "restaurant"
    assert normalize_type("Boat cruise") == "experience"


@pytest.mark.parametrize(
    "text",
    [
        "Entry ¥2,000",
        "about ฿500",
        "500 rupees each",
        "Rs 800",
        "Rs. 1,200",
        "2,000 yen",
        "costs 30 dollars",
        "€12 to €15",
        "₹ 1,200",
        "around 2k INR",
        "3 lakh rupees",
        "1500 baht",
    ],
)
def test_prices_in_every_currency_we_serve_are_caught(text):
    assert PRICE_PATTERN.search(text), text


@pytest.mark.parametrize(
    "text", ["3 days in Goa", "Day 2 at 9:30", "2 kids and 1 dog", "Route 66", "4 nights"]
)
def test_numbers_that_are_not_prices_are_left_alone(text):
    assert not PRICE_PATTERN.search(text), text


@pytest.mark.parametrize(
    ("value", "expected"),
    [("lunch", "afternoon"), ("Sunset", "evening"), ("brunch", None), (None, None)],
)
def test_time_of_day_is_normalised(value, expected):
    _, s, _ = validate(
        {"suggestions": [{"name": "X", "type": "attraction", "time_of_day": value}]}, []
    )
    assert s[0]["time_of_day"] == expected


# Plan check honesty --------------------------------------------------------------------


def test_general_knowledge_plans_are_not_stamped_as_checked():
    general = [
        {
            "name": "Blue Lagoon",
            "type": "attraction",
            "location_id": None,
            "from_knowledge_base": False,
            "is_placeholder": False,
            "day": 1,
            "time_of_day": None,
            "duration_minutes": None,
            "price": None,
            "why": "",
        }
    ]
    assert (
        check_and_repair(general, {}, [], {}, Constraints(duration_days=1)).status
        == "not_applicable"
    )


def test_mixed_plans_flag_the_places_we_could_not_verify():
    known = Location(
        id=uuid.uuid4(),
        name="Tower Bridge",
        type=LocationType.ATTRACTION,
        duration_minutes=60,
        best_times=[],
        opening_hours={},
        price_note="",
    )
    plan = [
        {
            "name": "Tower Bridge",
            "type": "attraction",
            "location_id": str(known.id),
            "from_knowledge_base": True,
            "is_placeholder": False,
            "day": 1,
            "time_of_day": None,
            "duration_minutes": 60,
            "price": None,
            "why": "",
        },
        {
            "name": "Some pub",
            "type": "restaurant",
            "location_id": None,
            "from_knowledge_base": False,
            "is_placeholder": False,
            "day": 1,
            "time_of_day": None,
            "duration_minutes": None,
            "price": None,
            "why": "",
        },
    ]
    result = check_and_repair(plan, {str(known.id): known}, [], {}, Constraints())
    assert any(i.code == "unverified_places" and "Some pub" in i.message for i in result.issues)


# Intent --------------------------------------------------------------------------------


def test_an_old_trip_length_cue_does_not_license_a_new_length():
    model = Intent(destination="Goa", duration_days=3)
    out = reconcile(
        model,
        heuristic_intent("make it relaxed", ["Goa"], []),
        ["make it relaxed", "5 days in Goa"],
        {"destination": "Goa", "duration_days": 5},
        ["Goa"],
    )
    assert out.duration_days is None  # merge_state then keeps the 5 days already in the trip
    assert any("Ignored a 3-day" in c for c in out.corrections)


@pytest.mark.parametrize(
    ("tag", "interest", "expected"),
    [
        ("Art", "art", True),
        ("Apartment", "art", False),
        ("Street food", "street food", True),
        ("Street food", "food", True),
        ("Tea", "tea gardens", True),
        ("Steak", "tea", False),
        ("Scenic views", "scenic view", True),
        ("Spa", "spanish food", False),
    ],
)
def test_interests_match_tags_by_whole_words(tag, interest, expected):
    assert tag_matches(tag, interest) is expected


# Retrieval -----------------------------------------------------------------------------


async def test_a_country_without_cities_does_not_fall_through_to_everywhere(
    client, editor, traveler, london
):
    await client.post(
        "/admin/locations",
        json={"type": "country", "name": "Probeland", "status": "published"},
        headers=auth(editor),
    )
    async with SessionLocal() as session:
        dest, items = await pipeline.retrieve(
            session,
            AIOrchestrator(embedder=HashingEmbedder()),
            traveler.id,
            "bridge views",
            Intent(intent="recommend", search_query="bridge views"),
            {"destination": "Probeland"},
        )
    assert dest.name == "Probeland" and items == []


async def test_short_or_wildcard_destinations_do_not_match_random_cities(london):
    async with SessionLocal() as session:
        for name in ("a", "%", "_ondon", "L%"):
            assert await pipeline.resolve_destination(session, name) == (None, []), name
        found, _ = await pipeline.resolve_destination(session, "Lon")
        assert found.name == "London"


async def test_what_was_asked_is_kept_in_the_context(client, editor, traveler, london):
    """Profile-ranked picks used to crowd out direct matches for the question."""
    h = auth(editor)
    for i in range(14):  # plenty of profile-friendly places competing for 12 slots
        await client.post(
            "/admin/locations",
            json={
                "type": "attraction",
                "name": f"Scenic stop {i}",
                "parent_id": london["city"]["id"],
                "status": "published",
                "tag_ids": [london["tags"]["Scenic views"]],
                "summary": "views",
            },
            headers=h,
        )
    await client.put(
        "/profiles/me",
        json={"interest_tag_ids": [london["tags"]["Scenic views"]]},
        headers=auth(traveler),
    )
    async with SessionLocal() as session:
        _, items = await pipeline.retrieve(
            session,
            AIOrchestrator(embedder=HashingEmbedder()),
            traveler.id,
            "street food tasting market",
            Intent(intent="recommend", search_query="street food tasting market"),
            {"destination": "London"},
        )
    names = [i.location.name for i in items]
    assert len(names) <= 12
    assert "Borough Market Food Walk" in names[:6]


async def test_a_query_is_embedded_once_per_message(london, traveler):
    class Counting(HashingEmbedder):
        calls = 0

        async def embed(self, texts, kind="document"):
            Counting.calls += 1
            return await super().embed(texts, kind)

    ai = AIOrchestrator(embedder=Counting())
    async with SessionLocal() as session:
        await pipeline.retrieve(
            session,
            ai,
            traveler.id,
            "views",
            Intent(intent="plan_trip", search_query="views"),
            {"destination": "London", "interests": ["scenic views"]},
        )
        await pipeline.retrieve(
            session,
            ai,
            traveler.id,
            "views",
            Intent(intent="plan_trip", search_query="views"),
            {"destination": "London", "interests": ["scenic views"]},
        )
    assert Counting.calls == 2  # the message and the interests text, each embedded once
