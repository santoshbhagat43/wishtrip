"""Robustness of intent understanding: the model and the keyword parser check each other."""

import json
from datetime import date, timedelta

from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator
from app.modules.chat.intent import (
    Intent,
    _future_date,
    _parse_start_date,
    canonical_destination,
    heuristic_intent,
    mentioned,
    reconcile,
    understand,
)
from app.modules.chat.pipeline import merge_state

DESTINATIONS = ["Kerala", "Goa", "Bangkok", "Dharamshala", "McLeod Ganj", "Krabi", "London"]
TAGS = ["Street food", "Scenic views"]


def model_says(**fields) -> Intent:
    return Intent(**fields)


def fix(model: Intent, message: str, state=None, history=()) -> Intent:
    heuristic = heuristic_intent(message, DESTINATIONS, TAGS)
    return reconcile(model, heuristic, [message, *history], state or {}, DESTINATIONS)


# Destinations ------------------------------------------------------------------------------


def test_typos_map_to_known_destinations():
    assert canonical_destination("Kerela", DESTINATIONS) == "Kerala"
    assert canonical_destination("bangkock", DESTINATIONS) == "Bangkok"
    assert canonical_destination("Dharamsala", DESTINATIONS) == "Dharamshala"
    assert canonical_destination("Reykjavik", DESTINATIONS) == "Reykjavik"  # unknown stays as said
    assert heuristic_intent("5 days in Kerela please", DESTINATIONS, TAGS).destination == "Kerala"


def test_fuzzy_matching_does_not_confuse_look_alikes():
    assert canonical_destination("Tokyo", ["Kyoto"]) == "Tokyo"  # different first letter
    assert canonical_destination("Goa", ["Gaya"]) == "Goa"
    assert (
        heuristic_intent("I love good food", DESTINATIONS, TAGS).destination is None
    )  # "good" ≠ "Goa"
    assert heuristic_intent("a great trip", ["Greece"], TAGS).destination is None


def test_model_typo_is_canonicalised_and_noted():
    out = fix(model_says(destination="Kerela"), "5 days in Kerela")
    assert out.destination == "Kerala"
    assert any("Matched destination" in n for n in out.corrections)


def test_invented_destination_is_dropped():
    out = fix(model_says(destination="Goa"), "somewhere warm with beaches for a week")
    assert out.destination is None
    assert any("didn't mention" in n for n in out.corrections)


def test_destination_from_earlier_turns_is_kept():
    # Said two turns ago, or already in the trip state: not an invention.
    assert (
        fix(model_says(destination="Goa"), "make it relaxed", history=["4 days in Goa"]).destination
        == "Goa"
    )
    assert (
        fix(
            model_says(destination="Goa"), "make it relaxed", state={"destination": "Goa"}
        ).destination
        == "Goa"
    )


def test_mentioned_handles_partial_names_and_typos():
    assert mentioned("Munnar tea hills", ["a trip to munnar"])
    assert mentioned("Bangkok", ["bangkock street food"])
    assert not mentioned("Goa", ["somewhere warm"])


def test_model_miss_is_filled_from_the_message():
    out = fix(model_says(destination=None, companions=None), "3 days in Krabi with my wife")
    assert out.destination == "Krabi" and out.companions == "couple"
    assert any("Filled companions" in n for n in out.corrections)


# Trip length -------------------------------------------------------------------------------


def test_invented_trip_length_is_dropped():
    out = fix(model_says(destination="Goa", duration_days=3), "Plan Goa with friends")
    assert out.duration_days is None
    assert any("Ignored a 3-day" in n for n in out.corrections)


def test_real_trip_length_cues_are_kept():
    for message, days in [
        ("a week in Goa", 7),
        ("Goa for 4 nights", 4),
        ("a long weekend in Goa", 2),
    ]:
        assert fix(model_says(destination="Goa", duration_days=days), message).duration_days == days
    # Repeating the length already in the trip is fine.
    out = fix(model_says(duration_days=5), "more beaches please", state={"duration_days": 5})
    assert out.duration_days == 5


def test_model_and_keywords_disagreeing_on_companions_keeps_the_model():
    out = fix(model_says(companions="family"), "5 days with my wife and our two kids")
    assert out.companions == "family"  # the model's reading of the whole sentence wins


# Dates -------------------------------------------------------------------------------------


def test_heuristic_reads_common_date_formats():
    today = date(2026, 10, 10)
    assert _parse_start_date("from 2026-11-02", today) == date(2026, 11, 2)
    assert _parse_start_date("starting 12 nov", today) == date(2026, 11, 12)
    assert _parse_start_date("on the 3rd of march", today) == date(2027, 3, 3)  # next occurrence
    assert _parse_start_date("from november 12th 2026", today) == date(2026, 11, 12)
    assert _parse_start_date("31 feb", today) is None
    assert _parse_start_date("in winter", today) is None


def test_past_and_far_future_dates_are_corrected():
    today = date.today()
    last_month = today - timedelta(days=30)
    assert _future_date(last_month) == last_month.replace(year=last_month.year + 1)
    assert _future_date(today + timedelta(days=1000)) is None
    out = fix(model_says(start_date=last_month.isoformat()), "trip in a few weeks")
    assert out.start_date == last_month.replace(year=last_month.year + 1).isoformat()
    assert any("it had passed" in n for n in out.corrections)


# Clearing earlier details ------------------------------------------------------------------


def test_travelers_can_take_details_back():
    state = {
        "destination": "Goa",
        "start_date": "2026-11-02",
        "budget_level": 1,
        "duration_days": 5,
    }
    intent = heuristic_intent(
        "our dates are flexible now and budget doesn't matter", DESTINATIONS, TAGS
    )
    assert set(intent.cleared_fields) == {"start_date", "budget_level"}
    assert merge_state(state, intent) == {"destination": "Goa", "duration_days": 5}


def test_model_cleared_fields_are_validated_and_merged():
    out = fix(model_says(cleared_fields=["start_date"]), "forget the dates")
    assert out.cleared_fields == ["start_date"]


# Model failures ----------------------------------------------------------------------------


class Scripted:
    enabled, provider = True, "test"

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def model_for(self, task):
        return "test"

    async def chat(self, task, messages, **kwargs):
        self.calls.append({"messages": messages, **kwargs})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


async def test_a_bad_json_reply_is_retried_once():
    client = Scripted(
        "Sure, here's what I found!", json.dumps({"intent": "plan_trip", "destination": "Goa"})
    )
    intent = await understand(AIOrchestrator(client=client), "plan Goa", [], DESTINATIONS, TAGS)
    assert intent.source == "model" and intent.destination == "Goa"
    assert len(client.calls) == 2
    assert "not a valid JSON object" in client.calls[1]["messages"][-1]["content"]


async def test_two_bad_replies_fall_back_to_keywords():
    client = Scripted("nope", "[1, 2, 3]")
    intent = await understand(
        AIOrchestrator(client=client), "3 days in Goa", [], DESTINATIONS, TAGS
    )
    assert intent.source == "heuristic" and intent.duration_days == 3


async def test_an_unavailable_model_is_not_retried_and_uses_a_short_timeout():
    client = Scripted(AIUnavailableError("timed out"))
    intent = await understand(
        AIOrchestrator(client=client), "3 days in Goa", [], DESTINATIONS, TAGS
    )
    assert intent.source == "heuristic" and len(client.calls) == 1
    assert client.calls[0]["timeout"] == 20
    assert any("unavailable" in n for n in intent.corrections)


async def test_very_long_messages_are_truncated_before_the_model():
    client = Scripted(json.dumps({"intent": "recommend"}))
    await understand(AIOrchestrator(client=client), "Goa " * 5000, [], DESTINATIONS, TAGS)
    assert len(client.calls[0]["messages"][-1]["content"]) == 2000


# Times of day ------------------------------------------------------------------------------


def test_model_listing_every_time_of_day_keeps_only_what_was_asked():
    # A model often echoes every slot a plan uses; the traveler only said evenings.
    out = fix(
        model_says(preferred_times=["morning", "afternoon", "evening"]),
        "make it 4 days and we would rather be out in the evenings",
        history=["Plan 3 relaxed days in Kerala for my parents"],
    )
    assert out.preferred_times == ["evening"]
    assert any("Ignored preferred times morning, afternoon" in n for n in out.corrections)


def test_time_cues_count_beyond_the_literal_word():
    out = fix(
        model_says(preferred_times=["morning", "evening"]), "we love sunrise and dinner views"
    )
    assert out.preferred_times == ["morning", "evening"]
    # "3 nights" is a trip length, not a wish to be out at night.
    assert fix(model_says(preferred_times=["night"]), "3 nights in Goa").preferred_times == []
