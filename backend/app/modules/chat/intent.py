"""Step 1 of chat: understand what the traveler wants before retrieving anything."""

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import date

from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator
from app.modules.knowledge.models import LocationType, TimeOfDay
from app.modules.profiles.models import Companions

logger = logging.getLogger(__name__)

INTENTS = ("plan_trip", "recommend", "ask_info", "modify_plan", "smalltalk")


@dataclass
class Intent:
    intent: str = "recommend"
    destination: str | None = None
    duration_days: int | None = None
    start_date: str | None = None  # ISO date of day 1, when the traveler gives dates
    companions: str | None = None
    budget_level: int | None = None
    energy_level: int | None = None
    preferred_times: list[str] = field(default_factory=list)
    interests: list[str] = field(default_factory=list)
    location_types: list[str] = field(default_factory=list)
    search_query: str = ""
    source: str = "model"

    def to_dict(self) -> dict:
        return asdict(self)


INTENT_PROMPT = """You extract travel intent for Wishtrip, a trip-planning assistant.
Read the conversation and the traveler's latest message. Return ONLY a JSON object:
{
  "intent": one of %(intents)s,
  "destination": city or country name the traveler wants, or null,
  "duration_days": integer or null,
  "start_date": "YYYY-MM-DD" of day 1 if the traveler gave dates (today is %(today)s), or null,
  "companions": one of %(companions)s or null,
  "budget_level": 0 (free) to 4 (luxury) or null,
  "energy_level": 1 (very relaxed) to 5 (very active) or null,
  "preferred_times": subset of %(times)s,
  "interests": short lowercase phrases, e.g. ["street food", "history", "scenic views"],
  "location_types": subset of %(types)s the traveler is asking about, [] if not specific,
  "search_query": one sentence describing what to look for in the knowledge base
}
Only fill a field when the traveler said or clearly implied it. Never guess.
"family" means travelling with children; elderly parents or grandparents are "seniors".
Known destinations in our knowledge base: %(destinations)s
Known interest tags: %(tags)s"""


def _iso_date(value) -> str | None:
    try:
        return date.fromisoformat(str(value)).isoformat() if value else None
    except ValueError:
        return None


def _clean(raw: dict, fallback_query: str) -> Intent:
    def pick(value, allowed):
        return value if value in allowed else None

    def ints(value, lo, hi):
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return number if lo <= number <= hi else None

    # Only place types can narrow a search; "city"/"country" are containers, not suggestions.
    types = {t.value for t in LocationType} - {LocationType.CITY.value, LocationType.COUNTRY.value}
    times = {t.value for t in TimeOfDay}
    return Intent(
        intent=pick(raw.get("intent"), INTENTS) or "recommend",
        destination=(raw.get("destination") or None),
        duration_days=ints(raw.get("duration_days"), 1, 60),
        start_date=_iso_date(raw.get("start_date")),
        companions=pick(raw.get("companions"), {c.value for c in Companions}),
        budget_level=ints(raw.get("budget_level"), 0, 4),
        energy_level=ints(raw.get("energy_level"), 1, 5),
        preferred_times=[t for t in raw.get("preferred_times") or [] if t in times],
        interests=[str(i).lower()[:40] for i in raw.get("interests") or []][:8],
        location_types=[t for t in raw.get("location_types") or [] if t in types],
        search_query=str(raw.get("search_query") or fallback_query)[:300],
    )


async def understand(
    ai: AIOrchestrator,
    message: str,
    history: list[dict[str, str]],
    destinations: list[str],
    tags: list[str],
) -> Intent:
    if ai.enabled:
        system = INTENT_PROMPT % {
            "intents": json.dumps(INTENTS),
            "companions": json.dumps([c.value for c in Companions]),
            "times": json.dumps([t.value for t in TimeOfDay]),
            "types": json.dumps([t.value for t in LocationType]),
            "destinations": ", ".join(destinations[:200]) or "none yet",
            "tags": ", ".join(tags[:200]) or "none yet",
            "today": date.today().isoformat(),
        }
        try:
            raw = await ai.complete_json(
                "intent",
                [
                    {"role": "system", "content": system},
                    *history[-6:],
                    {"role": "user", "content": message},
                ],
            )
            return _clean(raw, message)
        except (AIUnavailableError, ValueError) as exc:
            logger.warning("Intent model failed, using heuristics: %s", exc)
    intent = heuristic_intent(message, destinations, tags)
    return intent


# Keyword fallback, used without an API key or when the model call fails. ---------------------

_PLACE_PATTERN = re.compile(
    r"\b(?:in|to|visit|visiting|around)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)*)"
)
_COMPANION_WORDS = {
    "seniors": ["parents", "grandparents", "elderly", "senior"],
    "family": ["kids", "children", "family", "son", "daughter"],
    "couple": [
        "wife",
        "husband",
        "partner",
        "girlfriend",
        "boyfriend",
        "honeymoon",
        "romantic",
        "couple",
    ],
    "friends": ["friends", "group", "buddies"],
    "solo": ["alone", "solo", "by myself"],
}
_TYPE_WORDS = {
    "hotel": ["hotel", "stay", "accommodation"],
    "restaurant": ["restaurant", "restaurants", "dinner", "lunch", "breakfast"],
    "attraction": ["attraction", "sight", "landmark", "see"],
    "experience": ["experience", "tour", "cruise"],
    "activity": ["activity", "activities", "do"],
    "route": ["drive", "route", "walk", "road trip"],
}


def heuristic_intent(message: str, destinations: list[str], tags: list[str]) -> Intent:
    text = message.lower()
    words = set(re.findall(r"[a-z]+", text))
    intent = Intent(search_query=message, source="heuristic")
    intent.destination = next((d for d in destinations if d.lower() in text), None)
    # A capitalised place after "in/to/visit" that we don't know yet ("in Atlantis").
    if intent.destination is None and (m := _PLACE_PATTERN.search(message)):
        intent.destination = m.group(1)
    if m := re.search(r"(\d+)\s*(day|night)", text):
        intent.duration_days = int(m.group(1))
        intent.intent = "plan_trip"
    if any(w in text for w in ("plan", "itinerary", "trip")):
        intent.intent = "plan_trip"
    for companion, cues in _COMPANION_WORDS.items():
        if any(c in text for c in cues):
            intent.companions = companion
            break
    if words & {"cheap", "budget", "affordable"}:
        intent.budget_level = 1
    elif words & {"luxury", "luxurious", "splurge"}:
        intent.budget_level = 4
    if words & {"relaxed", "relaxing", "slow", "chill", "easy"}:
        intent.energy_level = 2
    elif words & {"active", "adventure", "hiking", "energetic"}:
        intent.energy_level = 4
    intent.preferred_times = [
        t.value for t in TimeOfDay if t.value in words or f"{t.value}s" in words
    ]
    intent.interests = [t.lower() for t in tags if t.lower() in text]
    intent.location_types = [t for t, cues in _TYPE_WORDS.items() if words & set(cues)]
    return intent
