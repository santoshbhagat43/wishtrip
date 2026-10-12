"""Chat pipeline: intent -> knowledge retrieval -> Grok -> rule validation.

The knowledge base is the source of truth. Grok reasons over and explains what we
retrieved; anything it adds on its own is labeled, and facts we hold (durations,
prices) always override what the model says.
"""

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator, parse_json_object
from app.core.config import settings
from app.modules.chat.intent import Intent, understand
from app.modules.chat.models import ChatSession, Grounding
from app.modules.itinerary.feasibility import Constraints, Result, check_and_repair
from app.modules.knowledge.models import (
    Location,
    LocationRelation,
    LocationStatus,
    LocationType,
    RelationType,
    Tag,
)
from app.modules.profiles import service as profiles
from app.modules.profiles.models import Companions
from app.modules.recommendations.engine import (
    PreferenceOverrides,
    Preferences,
    passes_hard_constraints,
)
from app.modules.recommendations.service import load_preferences, recommend
from app.modules.search.service import semantic_search

logger = logging.getLogger(__name__)

MAX_CONTEXT_ITEMS = 12
QUERY_SLOTS = 6  # context slots reserved for direct matches to what was asked
RANK_POOL = 40  # candidates ranked before spreading across a destination's cities
TIME_SLOTS = 3  # context slots kept for places best at the traveler's preferred times of day
# Types we hold no real inventory for yet; never present model-invented ones as real.
PLACEHOLDER_TYPES = {"hotel", "flight"}
COST_LABELS = ["free", "budget", "moderate", "expensive", "luxury"]
_CURRENCY_SYMBOL = r"[£$€₹¥฿₩]|\b(?:USD|EUR|GBP|INR|JPY|THB|Rs\.?)"
_CURRENCY_WORD = r"(?:rupees?|rs\.?|yen|baht|dollars?|euros?|pounds?|usd|eur|gbp|inr|jpy|thb)\b"
_AMOUNT = r"\d[\d,.]*(?:\s?(?:k|lakh|lakhs))?"
# Prices in every currency our destinations use, symbol-first ("¥2,000") or word-after
# ("500 baht"), with ranges ("$15 to $20").
PRICE_PATTERN = re.compile(
    rf"(?:(?:{_CURRENCY_SYMBOL})\s?{_AMOUNT}(?:\s?(?:-|–|to)\s?(?:{_CURRENCY_SYMBOL})?\s?{_AMOUNT})?"
    rf"|\b{_AMOUNT}(?:\s?(?:-|–|to)\s?{_AMOUNT})?\s?{_CURRENCY_WORD})",
    re.IGNORECASE,
)
TIME_OF_DAY = {
    "morning": "morning",
    "breakfast": "morning",
    "sunrise": "morning",
    "early": "morning",
    "afternoon": "afternoon",
    "lunch": "afternoon",
    "midday": "afternoon",
    "noon": "afternoon",
    "evening": "evening",
    "dinner": "evening",
    "sunset": "evening",
    "dusk": "evening",
    "night": "night",
    "late": "night",
    "nightlife": "night",
}
TYPE_SYNONYMS = {
    "hotel": (
        "hotel",
        "resort",
        "stay",
        "accommodation",
        "homestay",
        "hostel",
        "guesthouse",
        "guest house",
        "villa",
        "lodge",
        "ryokan",
        "houseboat stay",
        "bnb",
        "b&b",
    ),
    "flight": ("flight", "airline", "plane", "air"),
    "restaurant": ("restaurant", "cafe", "café", "food", "dining", "bar", "eatery"),
    "activity": ("activity",),
    "attraction": ("attraction", "sight", "landmark", "museum"),
    "experience": ("experience", "tour", "cruise"),
    "route": ("route", "drive", "walk", "hike"),
}
STATE_FIELDS = (
    "destination",
    "duration_days",
    "start_date",
    "companions",
    "budget_level",
    "energy_level",
    "preferred_times",
    "interests",
)


@dataclass
class ContextItem:
    ref: str
    location: Location
    city: str | None
    score: float | None = None
    similarity: float | None = None
    reasons: list[str] = field(default_factory=list)
    # Similarity to what the traveler literally asked (semantic search on the message).
    query_similarity: float | None = None


@dataclass
class ChatResult:
    content: str
    intent: Intent
    grounding: Grounding
    suggestions: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    follow_ups: list[dict[str, Any]]
    validation_notes: list[str]
    model: str
    debug: dict[str, Any]
    itinerary: list[dict[str, Any]] = field(default_factory=list)
    feasibility: dict[str, Any] | None = None


# State ------------------------------------------------------------------------------------


def merge_state(state: dict, intent: Intent) -> dict:
    """Carry trip details across turns; newer explicit values replace older ones."""
    merged = dict(state)
    for key in intent.cleared_fields:  # "dates are flexible now" → forget the old dates
        merged.pop(key, None)
    for key in STATE_FIELDS:
        value = getattr(intent, key)
        if value not in (None, [], ""):
            merged[key] = value
    return merged


# Retrieval --------------------------------------------------------------------------------


async def resolve_destination(
    session: AsyncSession, name: str | None
) -> tuple[Location | None, list[uuid.UUID]]:
    """Match a destination to a city, a region ("Kerala") or a country; return its city ids."""
    if not name:
        return None, []
    # Models sometimes return "London." or "'Goa'": compare without surrounding punctuation.
    key = re.sub(r"^[\W_]+|[\W_]+$", "", name.lower())
    if not key:
        return None, []
    published = Location.status == LocationStatus.PUBLISHED
    containers = Location.type.in_([LocationType.CITY, LocationType.COUNTRY])
    alias_match = func.lower(func.array_to_string(Location.aliases, "|")).op("~")(
        rf"(^|\|){re.escape(key)}(\||$)"
    )
    rows = await session.scalars(
        select(Location).where(
            containers,
            published,
            or_(func.lower(Location.name) == key, Location.slug == key, alias_match),
        )
    )
    matches = list(rows.unique())
    if not matches and len(key) >= 3:
        # "Krabi" → "Krabi (Ao Nang)": a city whose name starts with the destination.
        pattern = re.sub(r"([%_\\])", r"\\\1", key) + "%"
        rows = await session.scalars(
            select(Location).where(
                Location.type == LocationType.CITY,
                published,
                Location.name.ilike(pattern, escape="\\"),
            )
        )
        matches = list(rows.unique())
    # Prefer a city over a country of the same name (e.g. "Singapore").
    city = next((m for m in matches if m.type == LocationType.CITY), None)
    if city:
        return city, [city.id]
    region_cities = list(
        (
            await session.scalars(
                select(Location).where(
                    Location.type == LocationType.CITY,
                    published,
                    func.lower(Location.region) == key,
                )
            )
        ).unique()
    )
    if region_cities:
        return region_cities[0], [c.id for c in region_cities]
    if matches:
        country = matches[0]
        ids = list(
            await session.scalars(
                select(Location.id).where(Location.parent_id == country.id, published)
            )
        )
        return country, ids
    return None, []


def _words(text: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2}


def tag_matches(tag: str, interest: str) -> bool:
    """Whole-word match either way: "street food" ↔ "Street food", "tea gardens" ↔ "Tea",
    but never "art" ↔ "Apartment"."""
    tag_words, interest_words = _words(tag), _words(interest)
    return (
        bool(tag_words)
        and bool(interest_words)
        and (tag_words <= interest_words or interest_words <= tag_words)
    )


async def _overrides(session: AsyncSession, state: dict) -> PreferenceOverrides:
    interests = state.get("interests") or []
    tag_ids: list[uuid.UUID] = []
    if interests:
        tags = (await session.execute(select(Tag.id, Tag.name))).all()
        tag_ids = [tag_id for tag_id, name in tags if any(tag_matches(name, i) for i in interests)]
    companions = state.get("companions")
    return PreferenceOverrides(
        energy_level=state.get("energy_level"),
        budget_level=state.get("budget_level"),
        companions=Companions(companions) if companions else None,
        preferred_times=state.get("preferred_times") or None,
        tag_ids=tag_ids,
        query_text=", ".join(interests),
    )


async def retrieve(
    session: AsyncSession,
    ai: AIOrchestrator,
    user_id: uuid.UUID,
    message: str,
    intent: Intent,
    state: dict,
) -> tuple[Location | None, list[ContextItem]]:
    destination, resolved_ids = await resolve_destination(session, state.get("destination"))
    if state.get("destination") and destination is None:
        # The traveler named a place we hold nothing about. Answering with look-alike places
        # from elsewhere would present unrelated knowledge as if it were about their trip.
        return None, []
    if destination is not None and not resolved_ids:
        # e.g. a country with no published cities yet: nothing of ours to offer there.
        return destination, []
    city_ids = list(resolved_ids)  # empty = no destination named: search everywhere

    # Planning or changing a whole trip needs every kind of place; only narrow for a
    # targeted question ("restaurants near Munnar").
    whole_trip = intent.intent in ("plan_trip", "modify_plan")
    types = None if whole_trip else [LocationType(t) for t in intent.location_types] or None
    # Profile + this conversation: the same hard constraints (accessibility, families, budget)
    # apply to every way a place can enter the context, not only the profile-ranked half.
    prefs = await load_preferences(session, user_id, await _overrides(session, state))
    items = await _gather(session, ai, user_id, message, intent, prefs, city_ids, types)
    if not items and types:
        items = await _gather(session, ai, user_id, message, intent, prefs, city_ids, None)

    # What the traveler literally asked for comes first (best query matches), then the
    # profile-ranked picks; otherwise "is Kyoto good for temples?" could lose its temples.
    asked = sorted(
        (i for i in items.values() if i.query_similarity is not None),
        key=lambda i: i.query_similarity or 0,
        reverse=True,
    )[:QUERY_SLOTS]
    rest = sorted(
        (i for i in items.values() if i not in asked),
        key=lambda i: (i.score or 0, i.query_similarity or 0),
        reverse=True,
    )
    ordered = [*asked, *rest][:MAX_CONTEXT_ITEMS]
    if whole_trip and city_ids and (times := state.get("preferred_times")):
        ordered = await _with_preferred_times(session, ordered, items, city_ids, times, prefs)
    for index, item in enumerate(ordered, start=1):
        item.ref = f"K{index}"
        parent = item.location.parent
        item.city = parent.name if parent is not None else None
    return destination, ordered


def _fits_times(location: Location, times: list[str]) -> bool:
    return bool(set(location.best_times or []) & set(times))


async def _with_preferred_times(
    session: AsyncSession,
    ordered: list[ContextItem],
    gathered: dict[uuid.UUID, ContextItem],
    city_ids: list[uuid.UUID],
    times: list[str],
    prefs: Preferences,
) -> list[ContextItem]:
    """ "We'd rather be out in the evenings" needs evening places to plan with. Profile ranking
    gives time of day little weight, so keep a few places that are best then in the context,
    replacing the lowest-ranked picks."""
    have = sum(1 for i in ordered if _fits_times(i.location, times))
    if have >= TIME_SLOTS:
        return ordered
    taken = {i.location.id for i in ordered}
    # Already-ranked candidates first (they passed the profile's hard constraints)...
    extra = [
        i
        for i in gathered.values()
        if i.location.id not in taken and _fits_times(i.location, times)
    ]
    if len(extra) < TIME_SLOTS - have:
        # ...then any published place in the destination that's best at those times.
        rows = await session.scalars(
            select(Location)
            .where(
                Location.parent_id.in_(city_ids),
                Location.status == LocationStatus.PUBLISHED,
                Location.type.not_in([LocationType.CITY, LocationType.COUNTRY, LocationType.HOTEL]),
                Location.best_times.overlap(times),
                Location.id.not_in(taken | {i.location.id for i in extra}),
            )
            .order_by(Location.highlight.desc(), Location.name)
            .limit(TIME_SLOTS)
        )
        extra += [
            ContextItem(
                ref="",
                location=loc,
                city=None,
                reasons=[f"best in the {', '.join(sorted(set(loc.best_times) & set(times)))}"],
            )
            for loc in rows.unique()
            if passes_hard_constraints(loc, prefs)
        ]
    extra = extra[: TIME_SLOTS - have]
    if not extra:
        return ordered
    # Drop the lowest-ranked picks that don't fit the times, never a direct match to the question.
    keep = list(ordered)
    for _ in extra:
        if len(keep) < MAX_CONTEXT_ITEMS:
            continue
        victim = next(
            (
                i
                for i in reversed(keep)
                if i.query_similarity is None and not _fits_times(i.location, times)
            ),
            None,
        )
        if victim is None:
            break
        keep.remove(victim)
    room = MAX_CONTEXT_ITEMS - len(keep)
    return keep + extra[:room]


def _spread(scored: list, key, per_city: int) -> list:
    """Keep ranking order but cap each city, so one city can't fill a multi-city region."""
    taken: dict[Any, int] = {}
    kept = []
    for entry in scored:
        city = key(entry)
        if taken.get(city, 0) < per_city:
            taken[city] = taken.get(city, 0) + 1
            kept.append(entry)
    return kept


async def _gather(
    session: AsyncSession,
    ai: AIOrchestrator,
    user_id: uuid.UUID,
    message: str,
    intent: Intent,
    prefs: Preferences,
    city_ids: list[uuid.UUID],
    types: list[LocationType] | None,
) -> dict[uuid.UUID, ContextItem]:
    """One search across every city of the destination (all of them — a region or country
    isn't capped), not one search per city."""
    items: dict[uuid.UUID, ContextItem] = {}
    per_city = max(2, MAX_CONTEXT_ITEMS // max(1, len(city_ids)) + 1)

    # Ranked by the recommendation engine (profile + this conversation's preferences)...
    if city_ids:
        _, ranked = await recommend(
            session,
            ai,
            user_id,
            city_ids=city_ids,
            types=types,
            limit=RANK_POOL,
            prefs=prefs,
        )
        for scored in _spread(ranked, lambda s: s.location.parent_id, per_city):
            items.setdefault(
                scored.location.id,
                ContextItem(
                    ref="",
                    location=scored.location,
                    city=None,
                    score=scored.score,
                    similarity=scored.similarity,
                    reasons=scored.reasons,
                ),
            )
    # ...plus direct semantic matches for what was literally asked.
    hits = await semantic_search(
        session,
        ai,
        intent.search_query or message,
        types=types,
        city_ids=city_ids or None,
        limit=RANK_POOL,
        min_similarity=ai.embedder.min_similarity,
    )
    hits = [
        h
        for h in hits
        if h.location.type not in (LocationType.COUNTRY, LocationType.CITY)
        and passes_hard_constraints(h.location, prefs)
    ]
    for hit in _spread(hits, lambda h: h.location.parent_id, per_city)[:QUERY_SLOTS]:
        item = items.setdefault(
            hit.location.id,
            ContextItem(ref="", location=hit.location, city=None, similarity=hit.similarity),
        )
        item.query_similarity = max(item.query_similarity or 0, hit.similarity)
    return items


async def _relations_text(session: AsyncSession, items: list[ContextItem]) -> list[str]:
    by_id = {i.location.id: i for i in items}
    if len(by_id) < 2:
        return []
    rows = await session.scalars(
        select(LocationRelation).where(
            LocationRelation.source_id.in_(by_id), LocationRelation.target_id.in_(by_id)
        )
    )
    lines = []
    for rel in rows.unique():
        a, b = by_id[rel.source_id], by_id[rel.target_id]
        detail = []
        if rel.travel_minutes is not None:
            detail.append(f"{rel.travel_minutes} min apart")
        if rel.distance_meters is not None:
            detail.append(f"{rel.distance_meters} m")
        if rel.note:
            detail.append(rel.note)
        verb = {
            RelationType.NEAR: "is near",
            RelationType.ROUTE_TO: "has a route to",
            RelationType.PAIRS_WITH: "pairs well with",
            RelationType.SIMILAR_TO: "is similar to",
            RelationType.ALTERNATIVE_TO: "is an alternative to",
        }[rel.relation]
        lines.append(f"{a.ref} {verb} {b.ref}" + (f" ({', '.join(detail)})" if detail else ""))
    return lines


def location_facts(item: ContextItem) -> str:
    loc = item.location
    lines = [f"[{item.ref}] {loc.name} — {loc.type}" + (f" in {item.city}" if item.city else "")]
    if loc.highlight:
        lines.append("  Must-see highlight")
    if loc.summary:
        lines.append(f"  Summary: {loc.summary}")
    if loc.description:
        lines.append(f"  Details: {loc.description[:600]}")
    lines.append(
        f"  Duration: {loc.duration_minutes} minutes"
        if loc.duration_minutes is not None
        else "  Duration: unknown"
    )
    if loc.best_times:
        lines.append(f"  Best time of day: {', '.join(loc.best_times)}")
    if loc.seasons:
        lines.append(f"  Seasons: {', '.join(loc.seasons)}")
    if loc.opening_hours:
        lines.append(f"  Opening hours: {json.dumps(loc.opening_hours)}")
    lines.append(f"  Price: {loc.price_note}" if loc.price_note else "  Price: NOT AVAILABLE")
    if loc.cost_level is not None:
        lines.append(f"  Cost level: {COST_LABELS[loc.cost_level]}")
    if loc.energy_level is not None:
        lines.append(f"  Energy level: {loc.energy_level}/5")
    flags = [
        label
        for label, value in (
            ("family friendly", loc.family_friendly),
            ("good for couples", loc.couple_friendly),
            ("wheelchair accessible", loc.accessible),
        )
        if value
    ]
    if flags:
        lines.append(f"  Suitable: {', '.join(flags)}")
    if loc.tags:
        lines.append(f"  Tags: {', '.join(t.name for t in loc.tags)}")
    if loc.pros:
        lines.append(f"  Pros: {'; '.join(loc.pros)}")
    if loc.cons:
        lines.append(f"  Cons: {'; '.join(loc.cons)}")
    if loc.tips:
        lines.append(f"  Tips: {loc.tips}")
    if item.reasons:
        lines.append(f"  Why it fits this traveler: {', '.join(item.reasons)}")
    return "\n".join(lines)


# Generation -------------------------------------------------------------------------------

PLANNER_PROMPT = """You are WishTrip's travel planner.

KNOWLEDGE BASE RULES
- The KNOWLEDGE BASE below is WishTrip's verified data and the source of truth.
- Always prefer knowledge-base places. Cite them with their reference, e.g. [K2].
- Never contradict knowledge-base facts (durations, opening hours, suitability).
- If the knowledge base has nothing relevant, you may use general knowledge, but say clearly
  that those suggestions are not yet in WishTrip's knowledge base, and set "kb_ref": null.

DATA HONESTY RULES
- NEVER state prices, fares or costs unless the knowledge base gives a Price for that place.
  Otherwise say pricing is not available yet.
- WishTrip has no live hotel or flight inventory yet. Do not name specific hotels or flights
  unless they are in the knowledge base; describe the kind of option instead.
- Do not invent durations, opening hours, ratings or distances.

CONVERSATION
- First understand intent. If the destination is missing, ask for it (at most two short
  questions) and still offer a few useful ideas.
- If only the trip length is missing, don't stall: plan a sensible length (say which, e.g.
  "Here's a 5-day plan") and ask whether they'd like it longer or shorter.
- A trip plan is a COMPLETE day-by-day itinerary. Every day has a morning, an afternoon and
  an evening: 2–4 stops plus a meal idea, each in "suggestions" with its "day" and
  "time_of_day". Keep the first day lighter around arrival and the last around departure,
  and group each day's stops by area so it doesn't zig-zag.
- When the knowledge base has places for the destination, build the plan from them only. If
  nothing there fits a slot, leave it as free time ("free evening to wander") — don't fill
  it from general knowledge.
- If the knowledge base doesn't cover the destination, still write the complete itinerary
  from general knowledge, with specific, well-known place names (never vague ones like "a
  beach" or "a mountain viewpoint") and "kb_ref": null; say once that WishTrip hasn't
  checked these places yet.
- If the traveler says where they're coming from, add a "flight" suggestion on the first and
  last day; add one "hotel" suggestion per area they stay in. Both are shown as placeholders.
- Be warm and concise. In the reply, give each day a short heading and Morning / Afternoon /
  Evening lines.
- If TRIP SO FAR has preferred_times, the traveler wants to be out then: give each day at
  least one stop at each of those times, using places whose "Best time of day" matches, and
  set its "time_of_day". Keep the rest of the day lighter rather than dropping those stops.
- When a place you include has Tips, work the useful ones into the plan (what to bring,
  when to book, when it closes) — they are WishTrip's own local knowledge.

Return ONLY a JSON object:
{
  "reply": "markdown answer for the traveler",
  "suggestions": [
    {"kb_ref": "K1" or null, "name": "...", "type": one of %(types)s,
     "day": integer or null, "time_of_day": "morning|afternoon|evening|night" or null,
     "duration_minutes": integer or null, "why": "one sentence"}
  ],
  "follow_up_questions": [
    {"question": "a short question for the traveler",
     "answers": ["2-4 short likely answers, e.g. \"Morning\", \"Evening\""]}
  ]   (up to 3; skip questions the traveler has already answered)
}"""


ANSWER_PROMPT = """You are WishTrip's travel assistant. The traveler asked a question or wants
suggestions — do NOT write a day-by-day itinerary. Answer directly and briefly.

- Use the KNOWLEDGE BASE below as the source of truth and cite places like [K2].
- If the knowledge base doesn't cover it, you may use general knowledge but say so clearly.
- NEVER state prices, fares or costs unless the knowledge base gives a Price for that place;
  otherwise say pricing isn't available yet. Don't invent hours, durations or ratings.
- If the conversation already has a plan, answer about that plan.
- For greetings or off-topic messages, reply briefly and steer back to trip planning.

Return ONLY a JSON object:
{
  "reply": "markdown answer",
  "suggestions": [{"kb_ref": "K1" or null, "name": "...", "type": one of %(types)s,
                   "why": "one sentence"}],
  "follow_up_questions": [
    {"question": "a short question for the traveler",
     "answers": ["2-4 short likely answers, e.g. \"Morning\", \"Evening\""]}
  ]   (up to 3; skip questions the traveler has already answered)
}"""

# Intents that get a day plan; everything else gets a direct answer.
PLAN_INTENTS = ("plan_trip", "modify_plan")


def wants_plan(intent: Intent) -> bool:
    return intent.intent in PLAN_INTENTS


def build_context(
    destination_name: str | None,
    destination_found: bool,
    items: list[ContextItem],
    relations: list[str],
    state: dict,
    intent: Intent,
) -> str:
    parts = [
        f"TRAVELER INTENT: {json.dumps(intent.to_dict())}",
        f"TRIP SO FAR: {json.dumps(state)}",
    ]
    if destination_name and not destination_found:
        parts.append(f"NOTE: '{destination_name}' is not in WishTrip's knowledge base yet.")
    if items:
        parts.append("KNOWLEDGE BASE:\n" + "\n\n".join(location_facts(i) for i in items))
        if relations:
            parts.append("RELATIONSHIPS:\n" + "\n".join(relations))
    else:
        parts.append("KNOWLEDGE BASE: no matching entries.")
    return "\n\n".join(parts)


async def generate(
    ai: AIOrchestrator,
    history: list[dict[str, str]],
    message: str,
    context: str,
    *,
    plan: bool = True,
) -> dict[str, Any]:
    types = json.dumps([*[t.value for t in LocationType], "flight"])
    system = (PLANNER_PROMPT if plan else ANSWER_PROMPT) % {"types": types}
    raw = await ai.complete(
        "planner",
        [
            {"role": "system", "content": system},
            {"role": "system", "content": context},
            *history[-8:],
            {"role": "user", "content": message},
        ],
        json_mode=True,
        temperature=0.5,
        # A complete multi-day plan lists 3–5 stops a day, so give it room.
        max_tokens=4000 if plan else 900,
    )
    return parse_json_object(raw)


def fallback_answer(
    intent: Intent, destination_name: str | None, items: list[ContextItem], state: dict
) -> dict[str, Any]:
    """Deterministic answer used when no AI key is configured or the model call fails."""
    lines: list[str] = []
    if items:
        where = f" in {destination_name}" if destination_name else ""
        lines.append(f"Here is what WishTrip's knowledge base suggests{where}:\n")
        for item in items[:8]:
            loc = item.location
            why = f" — {', '.join(item.reasons)}" if item.reasons else ""
            summary = loc.summary or "No summary yet."
            lines.append(f"- **{loc.name}** ({loc.type}) [{item.ref}]: {summary}{why}")
    elif destination_name:
        lines.append(f"WishTrip doesn't have {destination_name} in its knowledge base yet.")
    else:
        lines.append("I couldn't find anything matching that in WishTrip's knowledge base yet.")
    lines.append(
        "\n_The AI planner is unavailable right now, so this is a knowledge-base listing only._"
    )

    follow_ups: list[dict[str, Any]] = []
    if not state.get("destination"):
        follow_ups.append({"question": "Where would you like to go?", "answers": []})
    if not state.get("duration_days"):
        follow_ups.append(
            {"question": "How many days is your trip?", "answers": ["3 days", "5 days", "A week"]}
        )
    if not state.get("companions"):
        follow_ups.append(
            {
                "question": "Who are you travelling with?",
                "answers": ["Just me", "With my partner", "Family with kids", "Friends"],
            }
        )
    return {
        "reply": "\n".join(lines),
        "suggestions": [
            {
                "kb_ref": i.ref,
                "name": i.location.name,
                "type": i.location.type,
                "day": None,
                "time_of_day": None,
                "duration_minutes": None,
                "why": ", ".join(i.reasons),
            }
            for i in items[:8]
        ],
        "follow_up_questions": follow_ups[:3],
    }


# Validation -------------------------------------------------------------------------------


def follow_ups_from(raw: Any) -> list[dict[str, Any]]:
    """Questions for the traveler, each with up to 4 ready replies (models sometimes send
    bare strings, which become questions without ready replies)."""
    follow_ups: list[dict[str, Any]] = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, str):
            question, answers = item, []
        elif isinstance(item, dict):
            question, answers = item.get("question"), item.get("answers")
        else:
            continue
        question = str(question or "").strip()[:200]
        if not question:
            continue
        replies = (
            [str(a).strip()[:80] for a in answers or [] if str(a).strip()]
            if isinstance(answers, list)
            else []
        )
        follow_ups.append({"question": question, "answers": list(dict.fromkeys(replies))[:4]})
    return follow_ups[:3]


def normalize_type(value: Any) -> str:
    """Map whatever the model wrote ("Hotel", "resort", "Airline") onto our types, so the
    placeholder rule for hotels and flights can't be dodged by spelling."""
    text = str(value or "").strip().lower()
    for canonical, words in TYPE_SYNONYMS.items():
        if text in words or any(
            re.search(rf"\b{re.escape(w)}\b", text) for w in words if len(w) > 3
        ):
            return canonical
    return text[:32]


def normalize_day(value: Any) -> int | None:
    """Day numbers are positive integers (bools and day 0 are not days)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value)
    return value if isinstance(value, int) and 1 <= value <= 60 else None


# Staff tips travel with each planned stop, so what the team knows reaches the traveler even
# when the model leaves it out of the prose.
TIP_CHARS = 400


def validate(
    answer: dict[str, Any], items: list[ContextItem]
) -> tuple[str, list[dict[str, Any]], list[str]]:
    """Enforce the knowledge base over the model: facts we hold win, prices are never invented."""
    by_ref = {i.ref: i for i in items}
    known_prices = {i.location.price_note for i in items if i.location.price_note}
    notes: list[str] = []
    suggestions: list[dict[str, Any]] = []

    for raw in answer.get("suggestions") or []:
        if not isinstance(raw, dict) or not raw.get("name"):
            continue
        ref = raw.get("kb_ref")
        item = by_ref.get(ref) if ref else None
        if ref and item is None:
            notes.append(f"Dropped unknown knowledge-base reference {ref}.")
        suggestion: dict[str, Any] = {
            "name": str(raw["name"])[:200],
            "type": normalize_type(raw.get("type")),
            "location_id": None,
            "from_knowledge_base": False,
            "is_placeholder": False,
            "day": normalize_day(raw.get("day")),
            "time_of_day": TIME_OF_DAY.get(str(raw.get("time_of_day") or "").strip().lower()),
            "duration_minutes": None,
            "price": None,
            "why": str(raw.get("why") or "")[:400],
            "tip": None,
        }
        if item:
            loc = item.location
            model_duration = raw.get("duration_minutes")
            if (
                isinstance(model_duration, int)
                and loc.duration_minutes is not None
                and model_duration != loc.duration_minutes
            ):
                notes.append(
                    f"{loc.name}: duration corrected from {model_duration} to "
                    f"{loc.duration_minutes} min (knowledge base)."
                )
            suggestion.update(
                name=loc.name,
                type=loc.type.value,
                location_id=str(loc.id),
                from_knowledge_base=True,
                duration_minutes=loc.duration_minutes,
                price=loc.price_note or None,
                tip=(loc.tips or "").strip()[:TIP_CHARS] or None,
            )
        elif suggestion["type"] in PLACEHOLDER_TYPES:
            suggestion.update(
                name=f"Sample {suggestion['type']} option",
                is_placeholder=True,
                why="Placeholder — live inventory is not connected yet.",
            )
            notes.append(f"Replaced a model-suggested {suggestion['type']} with a placeholder.")
        suggestions.append(suggestion)

    reply = str(answer.get("reply") or "")

    def _strip_price(match: re.Match) -> str:
        text = match.group(0)
        if any(text in known for known in known_prices):
            return text
        notes.append(f"Removed unverified price '{text}' from the reply.")
        return "(price not available yet)"

    reply = PRICE_PATTERN.sub(_strip_price, reply)
    return reply, suggestions, notes


def grounding_for(
    destination_name: str | None,
    destination_found: bool,
    items: list[ContextItem],
    suggestions: list[dict[str, Any]],
) -> Grounding:
    if not items:
        return Grounding.GENERAL
    if destination_name and not destination_found:
        return Grounding.PARTIAL
    if any(not s["from_knowledge_base"] and not s["is_placeholder"] for s in suggestions):
        return Grounding.PARTIAL
    return Grounding.KNOWLEDGE_BASE


# Feasibility ------------------------------------------------------------------------------


async def _relation_minutes(
    session: AsyncSession, ids: set[uuid.UUID]
) -> dict[tuple[uuid.UUID, uuid.UUID], int]:
    """Stored travel minutes between any of these locations, in both directions."""
    if not ids:
        return {}
    rows = await session.scalars(
        select(LocationRelation).where(
            LocationRelation.travel_minutes.is_not(None),
            or_(LocationRelation.source_id.in_(ids), LocationRelation.target_id.in_(ids)),
        )
    )
    minutes: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
    for rel in rows.unique():
        minutes[(rel.source_id, rel.target_id)] = rel.travel_minutes
        minutes[(rel.target_id, rel.source_id)] = rel.travel_minutes
    return minutes


async def check_feasibility(
    session: AsyncSession,
    user_id: uuid.UUID,
    suggestions: list[dict[str, Any]],
    items: list[ContextItem],
    state: dict,
) -> Result:
    profile = await profiles.get_profile(session, user_id)
    start = state.get("start_date")
    constraints = Constraints(
        duration_days=state.get("duration_days"),
        energy_level=state.get("energy_level") or (profile.energy_level if profile else None),
        budget_level=state.get("budget_level")
        if state.get("budget_level") is not None
        else (profile.budget_level if profile else None),
        companions=state.get("companions") or (profile.companions if profile else None),
        accessibility_needs=bool(profile and profile.accessibility_needs),
        start_date=date.fromisoformat(start) if start else None,
        preferred_times=list(state.get("preferred_times") or []),
    )
    locations = {str(i.location.id): i.location for i in items}
    used = {s.get("location_id") for s in suggestions}
    pool = [i.location for i in items if str(i.location.id) not in used]
    ids = {i.location.id for i in items} | {
        i.location.parent_id for i in items if i.location.parent_id
    }
    relations = await _relation_minutes(session, ids)
    return check_and_repair(suggestions, locations, pool, relations, constraints)


REWRITE_PROMPT = """You are WishTrip's travel planner. Our plan check adjusted your itinerary so it
actually works (opening days, travel time, how much fits in a day, the traveler's constraints).
Rewrite your reply so it matches the FINAL ITINERARY exactly: same days, same places, same order.
Do not add places that aren't in it. Keep the same warm tone and format, and briefly mention the
adjustments listed. Never state prices. Return only the rewritten markdown reply."""


async def reconcile_reply(ai: AIOrchestrator, reply: str, result: Result) -> tuple[str, bool]:
    """Make the text agree with the repaired plan. Returns (reply, rewritten_by_model)."""
    if not result.changes:
        return reply, False
    final = [
        {
            "day": d["day"],
            "items": [
                {"name": i["name"], "start": i["start"], "time_of_day": i.get("time_of_day")}
                for i in d["items"]
            ],
        }
        for d in result.days
    ]
    if ai.enabled and settings.feasibility_rewrite:
        try:
            text = await ai.complete(
                "planner",
                [
                    {"role": "system", "content": REWRITE_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "original_reply": reply,
                                "final_itinerary": final,
                                "adjustments": result.changes,
                            }
                        ),
                    },
                ],
                temperature=0.3,
                max_tokens=4000,
            )
            if text.strip():
                return PRICE_PATTERN.sub("(price not available yet)", text.strip()), True
        except AIUnavailableError as exc:
            logger.warning("Rewrite after plan check failed: %s", exc)
    note = "\n".join(f"- {change}" for change in result.changes)
    return f"{reply}\n\n**Plan check — adjusted so the trip works:**\n{note}", False


# Orchestration ----------------------------------------------------------------------------


async def run(
    session: AsyncSession,
    ai: AIOrchestrator,
    chat: ChatSession,
    user_id: uuid.UUID,
    message: str,
    history: list[dict[str, str]],
) -> ChatResult:
    known = await session.execute(
        select(Location.name).where(
            Location.type.in_([LocationType.CITY, LocationType.COUNTRY]),
            Location.status == LocationStatus.PUBLISHED,
        )
    )
    destinations = [row[0] for row in known.all()]
    regions = await session.scalars(
        select(Location.region)
        .where(Location.type == LocationType.CITY, Location.region != "")
        .distinct()
    )
    aliases = await session.scalars(
        select(func.unnest(Location.aliases)).where(Location.status == LocationStatus.PUBLISHED)
    )
    destinations += [d for d in {*regions, *aliases} if d not in destinations]
    tags = list(await session.scalars(select(Tag.name)))

    intent = await understand(ai, message, history, destinations, tags, chat.state or {})
    state = merge_state(chat.state or {}, intent)
    plan = wants_plan(intent)
    if intent.intent == "smalltalk":
        destination, items = None, []  # a greeting needs no places
    else:
        destination, items = await retrieve(session, ai, user_id, message, intent, state)
    relations = await _relations_text(session, items)
    destination_name = state.get("destination")
    context = build_context(
        destination_name, destination is not None, items, relations, state, intent
    )

    model = "knowledge-base-fallback"
    answer: dict[str, Any] | None = None
    if ai.enabled:
        try:
            answer = await generate(ai, history, message, context, plan=plan)
            model = ai.model_for("planner")
        except (AIUnavailableError, ValueError) as exc:
            logger.warning("Planner model failed, falling back: %s", exc)
    if answer is None:
        answer = fallback_answer(
            intent, destination_name or (destination.name if destination else None), items, state
        )

    reply, suggestions, notes = validate(answer, items)
    if not plan:
        # Questions and suggestions are answers, not itineraries: no days, so no plan check
        # and no rewrite — whatever the model returned.
        for suggestion in suggestions:
            suggestion["day"] = None
    result = await check_feasibility(session, user_id, suggestions, items, state)
    if result.status != "not_applicable":
        suggestions = result.suggestions
        reply, rewritten = await reconcile_reply(ai, reply, result)
        if rewritten:
            notes.append("Reply rewritten to match the plan-check adjustments.")
    chat.state = state
    return ChatResult(
        content=reply,
        intent=intent,
        grounding=grounding_for(destination_name, destination is not None, items, suggestions),
        suggestions=suggestions,
        sources=[
            {
                "ref": i.ref,
                "location_id": str(i.location.id),
                "name": i.location.name,
                "type": i.location.type.value,
                "city": i.city,
                "score": i.score,
                "similarity": i.similarity,
            }
            for i in items
        ],
        follow_ups=follow_ups_from(answer.get("follow_up_questions")),
        validation_notes=notes,
        model=model,
        debug={"context": context, "state": state, "embedder": ai.embedder.name},
        itinerary=result.days,
        feasibility=None if result.status == "not_applicable" else result.report(),
    )
