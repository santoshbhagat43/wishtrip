"""Complete a creator's itinerary.

A video only names what it names: a 12-second short may name three places, a voice-over may name
none. A creator's itinerary must still be a whole trip, never a single day of three stops. So after
reading a video, the places it names are topped up until every day has a full day's plan, from:

  1. WishTrip's checked knowledge base for the destination (origin "kb"), then
  2. the AI's own knowledge of well-known places there, clearly labelled as a suggestion that is
     neither from the video nor checked (origin "suggested").

Everything the video named stays, first, and is labelled as coming from it (origin "reel"). If even
that cannot reach two days, no itinerary is made: we say so, rather than show a thin one.
"""

import re
import uuid
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, parse_json_object
from app.modules.knowledge.models import LocationType
from app.modules.reels.understand import _KIND_WORDS, _norm
from app.modules.search.service import semantic_search

MIN_DAYS = 2
DEFAULT_DAYS = 3
MAX_DAYS = 7
STOPS_PER_DAY = 3
MIN_STOPS_PER_DAY = 2

_KB_KIND = {
    LocationType.ATTRACTION: "sight",
    LocationType.RESTAURANT: "food",
    LocationType.ACTIVITY: "experience",
    LocationType.EXPERIENCE: "experience",
}
SUGGESTED_KINDS = {"sight", "food", "experience"}

SUGGEST_PROMPT = """You complete a travel itinerary for {destination}. A creator's video names some
places; the itinerary needs {need} more so that every day has a full day's plan.

Already in the itinerary (do not repeat any):
{have}

What the video is about: {summary}

Rules:
- Real, well-known places in {destination} only. Never invent a place. If you are not sure a place
  exists and is easy to find, leave it out.
- Match the style of the video, and mix sights, food and things to do.
- Give only the name, the kind and a few words on why it fits. No prices, opening hours,
  addresses or phone numbers.

Return JSON only:
{{"places": [{{"name": "...", "kind": "sight|food|experience", "why": "..."}}]}}"""


ARRANGE_PROMPT = """Arrange these stops into {days} days of a trip to {destination}.

Stops:
{stops}

Rules:
- Put stops that are close to each other on the same day, so no day zig-zags across the island or
  region, and order each day sensibly (sights in the morning, food around midday and in the
  evening, sunsets late).
- Spread them evenly: each day gets {low} to {high} stops.
- Use every stop exactly once, with its name written exactly as above. Add none.

Return JSON only, one list per day in order:
{{"days": [["stop name", "stop name"], ["stop name", "stop name"]]}}"""


class IncompleteItinerary(Exception):
    """Not enough to make a whole trip. `message` is for the creator to read."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass
class Plan:
    items: list[dict[str, Any]]
    days: int
    # True when the AI grouped the stops into days by where they are (each stop's `day` is set,
    # in order); else the caller spreads them evenly.
    arranged: bool = False


def target_days(days_hint: int | None) -> int:
    """The creator's own number of days when the video says one, never fewer than two."""
    return max(MIN_DAYS, min(MAX_DAYS, days_hint or DEFAULT_DAYS))


def _words(name: str) -> set[str]:
    return {w for w in _norm(name).split() if len(w) >= 3 and w not in _KIND_WORDS}


def _same_word(a: str, b: str) -> bool:
    return a == b or SequenceMatcher(None, a, b).ratio() >= 0.85  # "terrace" / "terraces"


def _already_there(name: str, items: list[dict[str, Any]]) -> bool:
    """The same place under another spelling. Sharing the city's name is not enough ("Ubud Palace"
    and "Ubud Monkey Forest" are different places): every distinctive word of the shorter name
    must be in the other, or one name must sit inside the other."""
    key = _norm(name)
    mine = _words(name)
    for item in items:
        other = _norm(str(item["name"]))
        if key == other or (min(len(key), len(other)) >= 5 and (key in other or other in key)):
            return True
        theirs = _words(str(item["name"]))
        short, long = (mine, theirs) if len(mine) <= len(theirs) else (theirs, mine)
        if short and all(any(_same_word(w, v) for v in long) for w in short):
            return True
    return False


def _item(
    name: str, kind: str, origin: str, note: str = "", location_id: str | None = None
) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "kind": kind,
        "name": name[:200],
        "note": note[:500],
        "day": None,
        "location_id": location_id,
        "verified": origin == "kb",
        "t": None,
        "origin": origin,
    }


async def _from_knowledge_base(
    session: AsyncSession,
    ai: AIOrchestrator,
    destination: str,
    destination_id: uuid.UUID | None,
    items: list[dict[str, Any]],
    need: int,
) -> list[dict[str, Any]]:
    """Checked places for the destination that the video didn't name."""
    if destination_id is None or need <= 0:
        return []
    hits = await semantic_search(
        session,
        ai,
        f"the best things to do and eat in {destination}",
        types=list(_KB_KIND),
        city_ids=[destination_id],
        limit=need * 3,
    )
    found: list[dict[str, Any]] = []
    for hit in hits:
        loc = hit.location
        if _already_there(loc.name, items + found):
            continue
        found.append(_item(loc.name, _KB_KIND[loc.type], "kb", loc.summary or "", str(loc.id)))
        if len(found) == need:
            break
    return found


async def _from_ai(
    ai: AIOrchestrator, destination: str, summary: str, items: list[dict[str, Any]], need: int
) -> list[dict[str, Any]]:
    """Well-known places the AI suggests for what is still missing, labelled as suggestions."""
    if need <= 0 or not destination or not ai.enabled:
        return []
    have = "\n".join(f"- {i['name']}" for i in items) or "- (nothing yet)"
    prompt = SUGGEST_PROMPT.format(
        destination=destination, need=need, have=have, summary=summary or "a trip"
    )
    try:
        raw = await ai.complete(
            "planner",
            [{"role": "system", "content": prompt}, {"role": "user", "content": destination}],
            json_mode=True,
            temperature=0.3,
            max_tokens=900,
        )
        data = parse_json_object(raw)
    except Exception:  # noqa: BLE001 - the AI being down means "no suggestions", not a failed reel
        return []
    found: list[dict[str, Any]] = []
    for p in data.get("places") or []:
        if not isinstance(p, dict):
            continue
        name = re.sub(r"\s+", " ", str(p.get("name") or "")).strip()
        kind = p.get("kind") if p.get("kind") in SUGGESTED_KINDS else "sight"
        if not name or len(name) > 100 or _already_there(name, items + found):
            continue
        found.append(_item(name, kind, "suggested", str(p.get("why") or "").strip()))
        if len(found) == need:
            break
    return found


async def complete(
    session: AsyncSession,
    ai: AIOrchestrator | None,
    *,
    destination: str,
    destination_id: uuid.UUID | None,
    summary: str,
    items: list[dict[str, Any]],
    days_hint: int | None,
) -> Plan:
    """The video's places, topped up to a whole trip, and how many days it spans."""
    days = target_days(days_hint)
    stops = [i for i in items if i["kind"] != "stay"]
    need = days * STOPS_PER_DAY - len(stops)
    extra: list[dict[str, Any]] = []
    if need > 0 and ai is not None:
        extra = await _from_knowledge_base(session, ai, destination, destination_id, items, need)
        extra += await _from_ai(ai, destination, summary, items + extra, need - len(extra))
    total = len(stops) + len(extra)
    if total < MIN_DAYS * MIN_STOPS_PER_DAY:
        raise IncompleteItinerary(
            "We found too few places in that video to build a full itinerary. "
            "Try a video that names more of the places, or upload a longer one."
        )
    # Short of the target (the AI was unavailable, say): fewer days, but never fewer than two,
    # and never a day with just one stop.
    days = max(MIN_DAYS, min(days, total // MIN_STOPS_PER_DAY))
    everything = [*items, *extra]
    # Added stops are scattered across the destination: group the days by where things are.
    arranged = bool(extra) and ai is not None and await _arrange(ai, destination, everything, days)
    return Plan(items=everything, days=days, arranged=arranged)


async def _arrange(
    ai: AIOrchestrator, destination: str, items: list[dict[str, Any]], days: int
) -> bool:
    """Group the stops into days by where they are. Sets each stop's `day` and returns True, or
    leaves everything alone and returns False when the AI's answer isn't a sound arrangement."""
    stops = [i for i in items if i["kind"] != "stay"]
    if not ai.enabled or len(stops) < days * MIN_STOPS_PER_DAY:
        return False
    low, high = len(stops) // days, -(-len(stops) // days)
    prompt = ARRANGE_PROMPT.format(
        days=days,
        destination=destination or "this destination",
        stops="\n".join(f"- {i['name']} ({i['kind']})" for i in stops),
        low=low,
        high=high,
    )
    try:
        raw = await ai.complete(
            "planner",
            [{"role": "system", "content": prompt}, {"role": "user", "content": destination}],
            json_mode=True,
            temperature=0.1,
            max_tokens=900,
        )
        grouped = parse_json_object(raw).get("days")
    except Exception:  # noqa: BLE001 - no arrangement is fine: the even spread stands
        return False
    by_name = {str(i["name"]): i for i in stops}
    if not isinstance(grouped, list) or len(grouped) != days:
        return False
    used: list[str] = []
    for day in grouped:
        if not isinstance(day, list) or not (low <= len(day) <= high):
            return False
        used += [str(n) for n in day]
    # Every stop once, and nothing the AI made up.
    if sorted(used) != sorted(by_name):
        return False
    for n, day in enumerate(grouped, start=1):
        for name in day:
            by_name[str(name)]["day"] = n
    # Keep the AI's order inside each day: the stops in their day order, stays first.
    order = {name: k for k, name in enumerate(used)}
    items.sort(key=lambda i: (i["kind"] != "stay", order.get(str(i["name"]), 0)))
    return True
