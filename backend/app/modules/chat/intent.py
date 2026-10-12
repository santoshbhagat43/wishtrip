"""Step 1 of chat: understand what the traveler wants before retrieving anything."""

import difflib
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
from app.modules.knowledge.models import LocationType, TimeOfDay
from app.modules.profiles.models import Companions

logger = logging.getLogger(__name__)

INTENTS = ("plan_trip", "recommend", "ask_info", "modify_plan", "smalltalk")
# Trip details a traveler can explicitly take back ("dates are flexible", "no budget limit").
CLEARABLE = (
    "destination",
    "duration_days",
    "start_date",
    "companions",
    "budget_level",
    "energy_level",
    "preferred_times",
    "interests",
)
MAX_MESSAGE_CHARS = 2000
FUZZY_CUTOFF = 0.8


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
    # Fields the traveler explicitly removed this turn; merge_state drops them from the trip.
    cleared_fields: list[str] = field(default_factory=list)
    source: str = "model"
    # What the reconcile step changed and why (shown to staff for debugging).
    corrections: list[str] = field(default_factory=list)

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
  "search_query": one sentence describing what to look for in the knowledge base,
  "cleared_fields": fields from %(clearable)s the traveler explicitly removed or made open
                    in this message (e.g. "dates are flexible" → ["start_date"]), else []
}
Only fill a field when the traveler said or clearly implied it. Never guess or use defaults:
if no trip length is given, duration_days is null; if no place is named, destination is null.
"family" means travelling with children; elderly parents or grandparents are "seniors".
When the traveler asks to change an existing plan to be easier or more relaxing, set
energy_level to 1-2 (more active or adventurous: 4-5).
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
        cleared_fields=[f for f in raw.get("cleared_fields") or [] if f in CLEARABLE],
    )


RETRY_PROMPT = "Your previous reply was not a valid JSON object. Reply with ONLY the JSON object."


async def _model_intent(
    ai: AIOrchestrator, messages: list[dict[str, str]], fallback_query: str
) -> Intent | None:
    """Ask the model, retrying once if the reply isn't valid JSON. None = give up."""
    for attempt in range(2):
        try:
            raw = await ai.complete_json(
                "intent", messages, timeout=settings.intent_timeout_seconds
            )
            return _clean(raw, fallback_query)
        except ValueError as exc:  # not JSON / not an object
            logger.warning("Intent reply was not JSON (attempt %d): %s", attempt + 1, exc)
            messages = [*messages, {"role": "system", "content": RETRY_PROMPT}]
        except AIUnavailableError as exc:  # unreachable, timed out, provider error: fail fast
            logger.warning("Intent model unavailable: %s", exc)
            return None
    return None


async def understand(
    ai: AIOrchestrator,
    message: str,
    history: list[dict[str, str]],
    destinations: list[str],
    tags: list[str],
    state: dict | None = None,
) -> Intent:
    message = message[:MAX_MESSAGE_CHARS]
    heuristic = heuristic_intent(message, destinations, tags)
    if not ai.enabled:
        return heuristic
    system = INTENT_PROMPT % {
        "intents": json.dumps(INTENTS),
        "companions": json.dumps([c.value for c in Companions]),
        "times": json.dumps([t.value for t in TimeOfDay]),
        "types": json.dumps([t.value for t in LocationType]),
        "clearable": json.dumps(CLEARABLE),
        "destinations": ", ".join(destinations[:200]) or "none yet",
        "tags": ", ".join(tags[:200]) or "none yet",
        "today": date.today().isoformat(),
    }
    model = await _model_intent(
        ai,
        [
            {"role": "system", "content": system},
            *history[-6:],
            {"role": "user", "content": message},
        ],
        message,
    )
    if model is None:
        heuristic.corrections.append(
            "The language model was unavailable; used keyword understanding."
        )
        return heuristic
    user_texts = [message] + [m["content"] for m in history if m.get("role") == "user"][-6:]
    return reconcile(model, heuristic, user_texts, state or {}, destinations)


# Reconcile: the model and the keyword parser check each other --------------------------------

_FILLABLE = (
    "companions",
    "budget_level",
    "energy_level",
    "duration_days",
    "start_date",
    "preferred_times",
)


def close_match(key: str, candidates: list[str]) -> str | None:
    """Best typo-level match. Same first letter required: real typos rarely change it, and it
    keeps look-alikes apart (Kyoto/Tokyo)."""
    key = key.lower()
    pool = [c for c in candidates if c[:1].lower() == key[:1]]
    hits = difflib.get_close_matches(key, [c.lower() for c in pool], n=1, cutoff=FUZZY_CUTOFF)
    return next((c for c in pool if hits and c.lower() == hits[0]), None)


def canonical_destination(name: str | None, destinations: list[str]) -> str | None:
    """Map a name (possibly misspelt) to a known destination, keeping unknown names as-is."""
    if not name:
        return None
    by_lower = {d.lower(): d for d in destinations}
    key = name.strip().lower()
    if key in by_lower:
        return by_lower[key]
    return close_match(key, destinations) or name.strip()


def _phrases(text: str, max_words: int = 4) -> set[str]:
    words = re.findall(r"[a-z][a-z'-]*", text.lower())
    return {" ".join(words[i : i + n]) for n in range(1, max_words + 1) for i in range(len(words))}


def mentioned(name: str, texts: list[str]) -> bool:
    """Did the traveler actually say this place (allowing for typos and partial names)?"""
    key = name.lower()
    for text in texts:
        lowered = text.lower()
        if key in lowered or any(part in lowered for part in key.split() if len(part) >= 4):
            return True
        if close_match(key, sorted(_phrases(text))):
            return True
    return False


def _has_duration_cue(texts: list[str]) -> bool:
    return any(_duration_days(t.lower()) is not None for t in texts)


# Words that tie a time of day to what the traveler wrote. Broader than the keyword parser's
# literal "evening": used only to veto times the model added on its own. ("nights" is left out
# on purpose — "3 nights in Goa" is a trip length, not a wish to be out at night.)
_TIME_CUES = {
    "morning": ("morning", "early", "sunrise", "dawn", "breakfast"),
    "afternoon": ("afternoon", "lunch", "midday", "noon"),
    "evening": ("evening", "sunset", "dusk", "dinner", "after work"),
    "night": ("nightlife", "at night", "night out", "late night", "after dark", "night market"),
}


def _has_time_cue(slot: str, texts: list[str]) -> bool:
    cues = _TIME_CUES.get(slot, (slot,))
    return any(re.search(rf"\b{re.escape(cue)}", t.lower()) for t in texts for cue in cues)


def reconcile(
    model: Intent, heuristic: Intent, user_texts: list[str], state: dict, destinations: list[str]
) -> Intent:
    notes = model.corrections

    # Destination: canonicalise typos, and never accept a place the traveler didn't mention.
    if model.destination:
        canonical = canonical_destination(model.destination, destinations)
        if canonical != model.destination:
            notes.append(f"Matched destination '{model.destination}' to '{canonical}'.")
            model.destination = canonical
        if model.destination != state.get("destination") and not mentioned(
            model.destination, user_texts
        ):
            notes.append(
                f"Ignored destination '{model.destination}': the traveler didn't mention it."
            )
            model.destination = heuristic.destination
    elif heuristic.destination:
        model.destination = heuristic.destination
        notes.append(f"Took destination '{heuristic.destination}' from the message.")

    # Trip length: only with a length cue in what the traveler wrote (models like to default).
    # A *change* of length needs a cue in this message; older messages set the old length.
    if (
        model.duration_days is not None
        and model.duration_days != state.get("duration_days")
        and not _has_duration_cue(user_texts[:1])
    ):
        notes.append(f"Ignored a {model.duration_days}-day trip length: none was given.")
        model.duration_days = None

    # Times of day: only ones the traveler asked for. Models like to list every slot a plan
    # uses ("morning, afternoon, evening") when the traveler only said "out in the evenings".
    unasked = [t for t in model.preferred_times if not _has_time_cue(t, user_texts)]
    if unasked:
        notes.append(f"Ignored preferred times {', '.join(unasked)}: the traveler didn't ask.")
        model.preferred_times = [t for t in model.preferred_times if t not in unasked]

    # Clear keyword signals fill what the model left empty.
    for name in _FILLABLE:
        if getattr(model, name) in (None, []) and getattr(heuristic, name) not in (None, []):
            setattr(model, name, getattr(heuristic, name))
            notes.append(f"Filled {name.replace('_', ' ')} from the message.")
    model.cleared_fields = sorted(set(model.cleared_fields) | set(heuristic.cleared_fields))

    # Dates: a start date in the past almost always means next year's occurrence.
    if model.start_date:
        fixed = _future_date(date.fromisoformat(model.start_date))
        if fixed is None:
            notes.append(f"Ignored start date {model.start_date}: too far away to be right.")
        elif fixed.isoformat() != model.start_date:
            notes.append(
                f"Moved start date {model.start_date} to {fixed.isoformat()} (it had passed)."
            )
        model.start_date = fixed.isoformat() if fixed else None
    return model


def _future_date(day: date, today: date | None = None) -> date | None:
    today = today or date.today()
    while day < today:
        day = day.replace(year=day.year + 1)
    return day if day <= today + timedelta(days=730) else None


# Keyword fallback, used without an API key or when the model call fails. ---------------------

_PLACE_PATTERN = re.compile(
    r"\b(?:in|to|visit|visiting|around)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)*)"
)
_COMPANION_WORDS = {  # checked in order: the most specific group wins
    "seniors": ["parents", "grandparents", "elderly", "senior", "seniors", "grandma", "grandpa"],
    "family": ["kids", "children", "child", "family", "son", "daughter", "toddler", "baby"],
    "couple": [
        "wife",
        "husband",
        "partner",
        "girlfriend",
        "boyfriend",
        "fiance",
        "fiancee",
        "honeymoon",
        "anniversary",
        "romantic",
        "couple",
    ],
    "friends": ["friends", "group", "buddies", "mates", "colleagues"],
    "solo": ["alone", "solo", "myself"],
}
_TYPE_WORDS = {  # only words that clearly ask for a kind of place ("do"/"see" are too generic)
    "hotel": ["hotel", "hotels", "stay", "accommodation", "resort"],
    "restaurant": ["restaurant", "restaurants", "dinner", "lunch", "breakfast", "cafe", "cafes"],
    "attraction": ["attraction", "attractions", "sights", "landmark", "landmarks", "museum"],
    "experience": ["experience", "experiences", "tour", "tours", "cruise"],
    "activity": ["activity", "activities"],
    "route": ["drive", "route", "walk", "walks", "hike", "hikes"],
}
_NUMBERS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "a": 1,
}
_DURATION = re.compile(
    r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a)\s+(?:[a-z-]+\s+){0,2}?"
    r"(day|night|week)s?\b"
)
_LOW_ENERGY = {"relaxed", "relaxing", "slow", "chill", "easy", "easier", "gentle", "lazy", "calm"}
_LOW_ENERGY_PHRASES = (
    "can't walk",
    "cannot walk",
    "not much walking",
    "limited mobility",
    "wheelchair",
)
_HIGH_ENERGY = {"active", "adventure", "adventurous", "hiking", "trekking", "energetic", "thrill"}
_MODIFY = re.compile(r"\b(replace|swap|instead|remove|change|move|drop)\b|\bday \d+\b")
_QUESTION_START = ("what", "when", "how", "is ", "are ", "which", "where", "do ", "does ", "can ")
_GREETINGS = {
    "hi",
    "hello",
    "hey",
    "hiya",
    "thanks",
    "thank",
    "you",
    "there",
    "good",
    "morning",
    "evening",
}


def _duration_days(text: str) -> int | None:
    if re.search(r"\bweekend\b", text):
        return 2
    if re.search(r"\bfortnight\b", text):
        return 14
    if m := _DURATION.search(text):
        count = int(m.group(1)) if m.group(1).isdigit() else _NUMBERS[m.group(1)]
        return count * 7 if m.group(2) == "week" else count
    return None


def heuristic_intent(message: str, destinations: list[str], tags: list[str]) -> Intent:
    text = message.lower()
    words = set(re.findall(r"[a-z]+", text))
    intent = Intent(search_query=message, source="heuristic")
    intent.destination = next(
        (d for d in destinations if re.search(rf"\b{re.escape(d.lower())}\b", text)), None
    )
    if intent.destination is None:  # typos: "Kerela", "Bangkock"
        known = [d for d in destinations if len(d) >= 4]
        for phrase in sorted(_phrases(text, 3), key=len, reverse=True):
            if len(phrase) >= 4 and (hit := close_match(phrase, known)):
                intent.destination = hit
                break
    # A capitalised place after "in/to/visit" that we don't know yet ("in Atlantis").
    if intent.destination is None and (m := _PLACE_PATTERN.search(message)):
        intent.destination = m.group(1)

    intent.duration_days = _duration_days(text)
    if intent.duration_days or words & {"plan", "planning", "itinerary", "trip", "holiday"}:
        intent.intent = "plan_trip"
    if _MODIFY.search(text):
        intent.intent = "modify_plan"
    elif intent.intent != "plan_trip" and (
        text.rstrip().endswith("?") or text.startswith(_QUESTION_START)
    ):
        intent.intent = "ask_info"
    if words and words <= _GREETINGS:
        intent.intent = "smalltalk"

    for companion, cues in _COMPANION_WORDS.items():
        if words & set(cues):
            intent.companions = companion
            break
    if words & {"cheap", "budget", "affordable", "backpacking"}:
        intent.budget_level = 1
    elif words & {"luxury", "luxurious", "splurge", "premium"}:
        intent.budget_level = 4
    if words & _LOW_ENERGY or any(p in text for p in _LOW_ENERGY_PHRASES):
        intent.energy_level = 1 if any(p in text for p in _LOW_ENERGY_PHRASES) else 2
    elif words & _HIGH_ENERGY:
        intent.energy_level = 4
    # "3 nights in Goa" is a trip length, not a wish to be out at night.
    timed = re.sub(r"\b(\d+|one|two|three|four|five|six|seven|few|several)\s+nights?\b", " ", text)
    intent.preferred_times = [t.value for t in TimeOfDay if re.search(rf"\b{t.value}s?\b", timed)]
    intent.interests = [t.lower() for t in tags if re.search(rf"\b{re.escape(t.lower())}\b", text)]
    intent.location_types = [t for t, cues in _TYPE_WORDS.items() if words & set(cues)]
    if start := _parse_start_date(text):
        intent.start_date = start.isoformat()
    intent.cleared_fields = [
        f for f, cues in _CLEAR_PHRASES.items() if any(c in text for c in cues)
    ]
    if "start_date" in intent.cleared_fields:
        intent.start_date = None
    if "budget_level" in intent.cleared_fields:
        intent.budget_level = None
    return intent


_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
        start=1,
    )
}
_CLEAR_PHRASES = {
    "start_date": (
        "flexible dates",
        "dates are flexible",
        "flexible on dates",
        "no fixed dates",
        "forget the dates",
        "any dates",
        "dates don't matter",
    ),
    "budget_level": (
        "no budget",
        "budget doesn't matter",
        "any budget",
        "money is no object",
        "budget is flexible",
    ),
    "duration_days": ("not sure how long", "flexible on length", "any length"),
}


def _parse_start_date(text: str, today: date | None = None) -> date | None:
    """ISO dates, "12 Nov", "Nov 12th", "12 November 2026" — the next such day if no year."""
    today = today or date.today()
    if m := re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", text):
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    month = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
    m = (
        re.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{month}(?:,?\s+(\d{{4}}))?", text)
        or None
    )
    if m:
        day, mon, year = int(m.group(1)), _MONTHS[m.group(2)], m.group(3)
    elif m := re.search(rf"\b{month}\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?\b", text):
        mon, day, year = _MONTHS[m.group(1)], int(m.group(2)), m.group(3)
    else:
        return None
    try:
        found = date(int(year) if year else today.year, mon, day)
    except ValueError:
        return None
    return found if year else _future_date(found, today)
