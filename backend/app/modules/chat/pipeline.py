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
from app.modules.recommendations.engine import PreferenceOverrides
from app.modules.recommendations.service import recommend
from app.modules.search.service import semantic_search

logger = logging.getLogger(__name__)

MAX_CONTEXT_ITEMS = 12
# Types we hold no real inventory for yet; never present model-invented ones as real.
PLACEHOLDER_TYPES = {"hotel", "flight"}
COST_LABELS = ["free", "budget", "moderate", "expensive", "luxury"]
PRICE_PATTERN = re.compile(
    r"(?:[£$€₹]|USD|EUR|GBP|INR)\s?\d[\d,.]*(?:\s?(?:-|–|to)\s?[£$€₹]?\d[\d,.]*)?"
)
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


@dataclass
class ChatResult:
    content: str
    intent: Intent
    grounding: Grounding
    suggestions: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    follow_ups: list[str]
    validation_notes: list[str]
    model: str
    debug: dict[str, Any]
    itinerary: list[dict[str, Any]] = field(default_factory=list)
    feasibility: dict[str, Any] | None = None


# State ------------------------------------------------------------------------------------


def merge_state(state: dict, intent: Intent) -> dict:
    """Carry trip details across turns; newer explicit values replace older ones."""
    merged = dict(state)
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
    key = name.lower().strip()
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
    if not matches:
        # "Krabi" → "Krabi (Ao Nang)": a city whose name starts with the destination.
        rows = await session.scalars(
            select(Location).where(
                Location.type == LocationType.CITY, published, Location.name.ilike(f"{key}%")
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


async def _overrides(session: AsyncSession, state: dict) -> PreferenceOverrides:
    interests = state.get("interests") or []
    tag_ids: list[uuid.UUID] = []
    if interests:
        tag_ids = list(
            await session.scalars(
                select(Tag.id).where(or_(*[Tag.name.ilike(f"%{i}%") for i in interests]))
            )
        )
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
    city_ids: list[uuid.UUID | None] = list(resolved_ids) or [None]

    # Planning or changing a whole trip needs every kind of place; only narrow for a
    # targeted question ("restaurants near Munnar").
    whole_trip = intent.intent in ("plan_trip", "modify_plan")
    types = None if whole_trip else [LocationType(t) for t in intent.location_types] or None
    items = await _gather(session, ai, user_id, message, intent, state, city_ids, types)
    if not items and types:
        items = await _gather(session, ai, user_id, message, intent, state, city_ids, None)

    ordered = sorted(
        items.values(), key=lambda i: (i.score or 0) + (i.similarity or 0), reverse=True
    )[:MAX_CONTEXT_ITEMS]
    for index, item in enumerate(ordered, start=1):
        item.ref = f"K{index}"
        parent = item.location.parent
        item.city = parent.name if parent is not None else None
    return destination, ordered


async def _gather(
    session: AsyncSession,
    ai: AIOrchestrator,
    user_id: uuid.UUID,
    message: str,
    intent: Intent,
    state: dict,
    city_ids: list[uuid.UUID | None],
    types: list[LocationType] | None,
) -> dict[uuid.UUID, ContextItem]:
    threshold = ai.embedder.min_similarity
    items: dict[uuid.UUID, ContextItem] = {}

    for city_id in city_ids[:6]:
        # Ranked by the recommendation engine (profile + this conversation's preferences)...
        if city_id is not None:
            _, ranked = await recommend(
                session,
                ai,
                user_id,
                city_id=city_id,
                types=types,
                limit=8,
                overrides=await _overrides(session, state),
            )
            for scored in ranked:
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
            city_id=city_id,
            limit=6,
            min_similarity=threshold,
        )
        for hit in hits:
            if hit.location.type in (LocationType.COUNTRY, LocationType.CITY):
                continue
            items.setdefault(
                hit.location.id,
                ContextItem(ref="", location=hit.location, city=None, similarity=hit.similarity),
            )
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
- First understand intent. If the destination or trip length is missing for a trip plan,
  ask at most two short questions, and still offer a few useful ideas if you can.
- Be warm and concise. Use short markdown sections; group itineraries by day.

Return ONLY a JSON object:
{
  "reply": "markdown answer for the traveler",
  "suggestions": [
    {"kb_ref": "K1" or null, "name": "...", "type": one of %(types)s,
     "day": integer or null, "time_of_day": "morning|afternoon|evening|night" or null,
     "duration_minutes": integer or null, "why": "one sentence"}
  ],
  "follow_up_questions": ["up to 3 short questions"]
}"""


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
    ai: AIOrchestrator, history: list[dict[str, str]], message: str, context: str
) -> dict[str, Any]:
    system = PLANNER_PROMPT % {"types": json.dumps([*[t.value for t in LocationType], "flight"])}
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
        max_tokens=2500,
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
        "\n_AI planner is offline (no OpenRouter key), so this is a knowledge-base listing only._"
    )

    follow_ups = []
    if not state.get("destination"):
        follow_ups.append("Where would you like to go?")
    if not state.get("duration_days"):
        follow_ups.append("How many days is your trip?")
    if not state.get("companions"):
        follow_ups.append("Who are you travelling with?")
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
            "type": str(raw.get("type") or "")[:32],
            "location_id": None,
            "from_knowledge_base": False,
            "is_placeholder": False,
            "day": raw.get("day") if isinstance(raw.get("day"), int) else None,
            "time_of_day": raw.get("time_of_day"),
            "duration_minutes": None,
            "price": None,
            "why": str(raw.get("why") or "")[:400],
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
                max_tokens=2500,
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

    intent = await understand(ai, message, history, destinations, tags)
    state = merge_state(chat.state or {}, intent)
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
            answer = await generate(ai, history, message, context)
            model = ai.model_for("planner")
        except (AIUnavailableError, ValueError) as exc:
            logger.warning("Planner model failed, falling back: %s", exc)
    if answer is None:
        answer = fallback_answer(
            intent, destination_name or (destination.name if destination else None), items, state
        )

    reply, suggestions, notes = validate(answer, items)
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
        follow_ups=[str(q)[:200] for q in (answer.get("follow_up_questions") or [])][:3],
        validation_notes=notes,
        model=model,
        debug={"context": context, "state": state, "embedder": ai.embedder.name},
        itinerary=result.days,
        feasibility=None if result.status == "not_applicable" else result.report(),
    )
