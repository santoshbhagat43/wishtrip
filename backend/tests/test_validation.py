"""Fact checks applied to the planner's answer, and how answers are labelled for travelers."""

import uuid

import pytest

from app.modules.chat.models import Grounding
from app.modules.chat.pipeline import ContextItem, grounding_for, validate
from app.modules.knowledge.models import Location, LocationType


def item(ref, name, *, minutes=None, price="", type_=LocationType.ATTRACTION):
    loc = Location(
        id=uuid.uuid4(), name=name, type=type_, duration_minutes=minutes, price_note=price, tags=[]
    )
    return ContextItem(ref=ref, location=loc, city="London")


@pytest.mark.parametrize(
    "text",
    [
        "Entry is £25 per adult.",
        "About ₹1,200 each.",
        "Roughly INR 500.",
        "USD 20-30 per person.",
        "Around $15 to $20.",
        "It costs €12.50.",
        "Tickets: GBP 18",
    ],
)
def test_unverified_prices_are_removed_in_any_format(text):
    reply, _, notes = validate({"reply": text, "suggestions": []}, [])
    assert "price not available yet" in reply
    assert not any(ch.isdigit() for ch in reply.replace("price not available yet", ""))
    assert notes and "unverified price" in notes[0]


def test_a_price_from_the_knowledge_base_is_kept_verbatim():
    museum = item("K1", "Museum", price="£25 per adult (checked Oct 2026)")
    reply, suggestions, notes = validate(
        {
            "reply": "Entry is £25 per adult.",
            "suggestions": [{"kb_ref": "K1", "name": "Museum", "type": "attraction"}],
        },
        [museum],
    )
    assert "£25" in reply and notes == []
    assert suggestions[0]["price"] == "£25 per adult (checked Oct 2026)"


def test_suggestion_fields_are_normalised_and_junk_is_ignored():
    _, suggestions, notes = validate(
        {
            "reply": "",
            "suggestions": [
                "not a dict",
                {"name": ""},
                {
                    "kb_ref": "K1",
                    "name": "anything",
                    "type": "route",
                    "day": "2",
                    "duration_minutes": 30,
                },
                {"kb_ref": None, "name": "Flight to Kochi", "type": "flight", "day": 1},
                {"kb_ref": None, "name": "A café we don't know", "type": "restaurant"},
            ],
        },
        [item("K1", "Scenic drive", minutes=240)],
    )
    assert len(suggestions) == 3
    drive, flight, cafe = suggestions
    assert (
        drive["name"] == "Scenic drive"
        and drive["duration_minutes"] == 240
        and drive["day"] == 2  # numeric strings are accepted as day numbers
    )
    assert (
        flight["is_placeholder"]
        and flight["name"] == "Sample flight option"
        and flight["price"] is None
    )
    assert not cafe["from_knowledge_base"] and not cafe["is_placeholder"] and cafe["price"] is None
    assert any("duration corrected from 30 to 240" in n for n in notes)


@pytest.mark.parametrize(
    ("destination", "found", "items", "suggestions", "expected"),
    [
        (None, False, [], [], Grounding.GENERAL),
        ("Reykjavik", False, [], [], Grounding.GENERAL),
        ("Reykjavik", False, ["x"], [], Grounding.PARTIAL),
        (
            "London",
            True,
            ["x"],
            [{"from_knowledge_base": True, "is_placeholder": False}],
            Grounding.KNOWLEDGE_BASE,
        ),
        (
            "London",
            True,
            ["x"],
            [{"from_knowledge_base": False, "is_placeholder": True}],
            Grounding.KNOWLEDGE_BASE,
        ),
        (
            "London",
            True,
            ["x"],
            [{"from_knowledge_base": False, "is_placeholder": False}],
            Grounding.PARTIAL,
        ),
    ],
)
def test_grounding_labels(destination, found, items, suggestions, expected):
    assert grounding_for(destination, found, items, suggestions) == expected
