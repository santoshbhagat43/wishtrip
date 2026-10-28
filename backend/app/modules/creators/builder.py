"""Build a trip for a party: a reel's (or a creator's) places, planned day by day for who is
going, following the Wishtrip planning rules in backend/prompt (basic.txt for every trip, then the
file for the group: solo, couple, family, elderly or flexible).

The AI plans; we check. Every place the trip is built from stays, exactly once, under its own name;
no day gets more than three main activities; nothing the AI invents is passed off as from the reel
(it is labelled a suggestion); no prices are made up. If there is no AI, or its answer does not
hold up, the places are arranged by rule instead, and the trip says it was not AI-built."""

import asyncio
import json
import logging
import re
import uuid
from functools import cache
from pathlib import Path
from typing import Any

from app.ai.orchestrator import AIOrchestrator, parse_json_object
from app.modules.reels.complete import _already_there

log = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parents[3] / "prompt"
PERSONAS = ("solo", "couple", "family", "elderly", "flexible")
SLOTS = ("morning", "afternoon", "evening")
KINDS = {"stay", "food", "sight", "experience", "area", "note", "travel"}
MAX_MAIN = 3
MAX_PER_DAY = 10
MAX_DAYS = 7
RETRY_SECONDS = 3


def persona(group: str, adults: int, kids: int, seniors: int) -> str:
    """Which planning rules apply: one traveller is solo; seniors with anyone else, or any mixed
    group, is flexible; seniors alone elderly; children family; two adults who said "couple" a
    couple; other adult groups flexible."""
    total = adults + kids + seniors
    if total <= 1:
        return "solo"
    if seniors and (kids or adults):
        return "flexible"
    if seniors:
        return "elderly"
    if kids:
        return "family"
    if group == "couple" and adults == 2:
        return "couple"
    return "flexible"


@cache
def rules_file(name: str) -> str:
    return (PROMPT_DIR / f"{name}.txt").read_text(encoding="utf-8").strip()


def rules(for_persona: str) -> str:
    """The basic rules, then the group's."""
    group_rules = rules_file(for_persona)
    return f"{rules_file('basic')}\n\n--- For this group ({for_persona}) ---\n{group_rules}"


CONTRACT = """You are planning a trip for Wishtrip. Follow the planning rules above. Fill the
bracketed details in the group's guidance from the Facts you are given; do not ask questions, all
the details you need are in the Facts.

Hard requirements for your answer:
- Plan exactly the number of days in the Facts, numbered from 1.
- Every place in "must_include" appears exactly once, with its name written exactly as given. They
  are the fixed things. A place with a "day" is on that day in the creator's own video: keep it
  on that day. Plan the days around them, grouping places that are close together.
- Each day has a morning, an afternoon and an evening part ("slot"). At most 3 main activities a
  day (sights and experiences that are not optional). Meals ("food") and rest or transfer notes
  ("note") do not count.
- Meals: every day has breakfast, lunch and dinner ("food"), except breakfast on the first day (they
  are travelling) and dinner on the last day. Name the dish or cuisine the place is known for and
  the area to eat in, for example "Lunch: Emirati machboos in Al Fahidi". Never invent a restaurant.
- Shape each day around where things are: put places that are close together on the same day, and
  keep the first and last day light (arriving, leaving). Every other day has something in the
  morning, the afternoon and the evening, never a single evening item on its own: add well-known
  real places or general suggestions marked "optional": true to fill it.
- Do not add flights, airport transfers or hotel check-out: Wishtrip adds those.
- Mark extra things as "optional": true. Anything you add that is not in must_include is
  "from_reel": false: only well-known real places or general suggestions (a beach walk, a local
  cafe), never an invented venue name, price, opening hour, address or phone number.
- A stay, if given, is checked in on day 1 in the afternoon ("stay" kind, in the note). If none is
  given, add one "stay" on day 1 named for the area to stay in (for example "Stay in Downtown
  Dubai"), not a hotel brand.
- "transfer": a few words on getting to the next stop ("about 20 min by car"), only when you
  are confident; otherwise leave it empty.
- "tips": four to six short practical tips: how to get around, what to book ahead, the best time
  of day for the big sights and the weather for the dates. If "travelling_from" is in another
  country than the destination ("same_country_trip" is false), one tip tells them to check entry and
  visa rules on the official government site (no costs, no promises). When "same_country_trip" is
  true, never mention visas or entry rules. When it is "unknown", mention them only if you are
  sure the destination is abroad. Use "reel_tips" where they help.
- No prices or costs anywhere.
Return JSON only:
{"summary": "one or two sentences on the shape of the trip",
 "days": [{"day": 1, "title": "short title", "items": [
   {"name": "...", "kind": "sight|food|experience|stay|note", "slot": "morning|afternoon|evening",
    "note": "a few words", "optional": false, "from_reel": true, "transfer": ""}]}],
 "tips": ["practical tips: transport, tickets, best time to go"]}"""


def facts(
    *,
    destination: str,
    days: int,
    adults: int,
    kids: int,
    seniors: int,
    pace: str,
    when: str,
    group: str,
    for_persona: str,
    summary: str,
    must: list[dict],
    origin_city: str = "",
    reel_tips: list[str] | None = None,
    domestic: bool | None = None,
) -> dict[str, Any]:
    return {
        "destination": destination,
        "days": days,
        "travellers": {"adults": adults, "children": kids, "seniors": seniors},
        "group": group,
        "planning_for": for_persona,
        "pace": pace,
        "when": when or "not decided",
        "budget": "not given (give no costs)",
        "travelling_from": origin_city or "not given",
        "same_country_trip": "unknown" if domestic is None else domestic,
        "what_the_reel_is_about": summary,
        "reel_tips": list(reel_tips or [])[:8],
        "must_include": [
            {
                "name": m["name"],
                "kind": m["kind"],
                "why": (m.get("note") or "")[:120],
                **(
                    {"day": m["video_day"]} if m.get("video_day") and m["video_day"] <= days else {}
                ),
            }
            for m in must
        ],
    }


def _item(
    name: str, kind: str, day: int, slot: str, *, origin: str, note: str = "",
    optional: bool = False, transfer: str = "", source: dict | None = None,
) -> dict[str, Any]:  # fmt: skip
    return {
        "id": (source or {}).get("id") or uuid.uuid4().hex,
        "kind": kind if kind in KINDS else "sight",
        "name": name[:200],
        "note": note[:500],
        "day": day,
        "location_id": (source or {}).get("location_id"),
        "verified": bool((source or {}).get("verified")) or origin == "kb",
        "t": (source or {}).get("t"),
        "origin": origin,
        "slot": slot if slot in SLOTS else "afternoon",
        "optional": optional,
        "transfer": transfer[:120],
    }


def _same(a: str, b: str) -> bool:
    return _already_there(a, [{"name": b}])


def _is_main(item: dict) -> bool:
    return item["kind"] in ("sight", "experience", "area") and not item["optional"]


def arrange(must: list[dict], days: int) -> list[dict]:
    """No AI: the places spread over the days, at most three main activities each, mornings for
    sights, midday for food, evenings last. The stay is checked in on day 1."""
    stays = [m for m in must if m["kind"] == "stay"]
    rest = [m for m in must if m["kind"] != "stay"]
    out: list[dict] = []
    per = max(1, -(-len(rest) // max(1, days)))
    for i, m in enumerate(rest):
        day = min(days, i // per + 1)
        if m.get("video_day"):
            day = min(days, m["video_day"])
        n = sum(1 for o in out if o["day"] == day)
        food = m["kind"] == "food"
        slot = "afternoon" if food else SLOTS[min(n, 2) if n < 3 else 2]
        out.append(_item(m["name"], m["kind"], day, slot, origin=m.get("origin") or "reel",
                         note=m.get("note") or "", source=m))  # fmt: skip
    for s in stays:
        out.insert(0, _item(s["name"], "stay", 1, "afternoon", origin=s.get("origin") or "reel",
                            note="Check in", source=s))  # fmt: skip
    out.sort(key=lambda i: (i["day"], i["kind"] != "stay", SLOTS.index(i["slot"])))
    return out


def clean(plan: Any, must: list[dict], days: int) -> tuple[list[dict], str, list[str]] | None:
    """The AI's plan as items, if it holds up: the right number of days, every place once. Places
    it left out are added (so nothing is lost), and a day over the limit has its extra main
    activities made optional. None when the answer is not a usable plan at all."""
    if not isinstance(plan, dict) or not isinstance(plan.get("days"), list):
        return None
    given = [d for d in plan["days"] if isinstance(d, dict) and isinstance(d.get("items"), list)]
    if len(given) < days:
        return None
    items: list[dict] = []
    unmatched = list(must)
    for n, d in enumerate(given[:days], start=1):
        for raw in d["items"][:MAX_PER_DAY]:
            if not isinstance(raw, dict):
                continue
            name = re.sub(r"\s+", " ", str(raw.get("name") or "")).strip()
            name = re.sub(r"^optional\s*[:\-–]\s*", "", name, flags=re.I)  # the flag says it
            if not name:
                continue
            source = next((m for m in unmatched if _same(name, m["name"])), None)
            if source is not None:
                unmatched.remove(source)
                name = source["name"]
            elif any(_same(name, o["name"]) for o in items):
                continue  # the same thing twice
            kind = str(raw.get("kind") or "sight")
            if source is not None and source["kind"] in KINDS:
                kind = source["kind"]
            items.append(_item(
                name, kind, n, str(raw.get("slot") or ""),
                origin=(source.get("origin") or "reel") if source else "suggested",
                note=str(raw.get("note") or "").strip() or ((source or {}).get("note") or ""),
                optional=bool(raw.get("optional")) and source is None,
                transfer=str(raw.get("transfer") or "").strip(), source=source,
            ))  # fmt: skip
    # Anything the AI dropped goes back in, on the lightest day.
    for m in unmatched:
        load = {
            d: sum(1 for i in items if i["day"] == d and _is_main(i)) for d in range(1, days + 1)
        }
        day = min(load, key=lambda d: load[d]) if m["kind"] != "stay" else 1
        items.append(_item(m["name"], m["kind"], day, "afternoon", origin=m.get("origin") or "reel",
                           note=m.get("note") or "", source=m))  # fmt: skip
    # At most three main activities a day: reel places first, then the extras become optional.
    for d in range(1, days + 1):
        room = MAX_MAIN
        for i in sorted((i for i in items if i["day"] == d and _is_main(i)),
                        key=lambda i: i["origin"] != "reel"):  # fmt: skip
            if room > 0:
                room -= 1
            elif i["origin"] != "reel":
                i["optional"] = True
    items.sort(key=lambda i: (i["day"], _rank(i), SLOTS.index(i["slot"])))
    tips = [str(t).strip()[:300] for t in plan.get("tips") or [] if str(t).strip()][:8]
    return items, str(plan.get("summary") or "").strip()[:400], tips


def _activities(items: list[dict], day: int) -> int:
    return sum(1 for i in items if i["day"] == day and i["kind"] in ("sight", "experience", "area"))


def thin_days(items: list[dict], days: int) -> list[int]:
    """The days that need more: a day in the middle of the trip with fewer than two things to see
    or do, or a first day with none (meals and travel do not count; optional suggestions do). The
    last day is for leaving, so it may be bare."""
    return [d for d in range(1, days) if _activities(items, d) < (2 if d > 1 else 1)]


def _rank(item: dict) -> int:
    """Where an item sits in its day: the flight in, then the stay, the day itself, then leaving."""
    if item.get("rank") is not None:
        return int(item["rank"])
    return -1 if item["kind"] == "stay" else 0


MEALS = (("breakfast", "morning", "Breakfast"), ("lunch", "afternoon", "Lunch"),
         ("dinner", "evening", "Dinner"))  # fmt: skip


def _meal_in(items: list[dict], day: int, word: str, slot: str) -> bool:
    for i in items:
        if i["day"] != day or i["kind"] != "food":
            continue
        if word in i["name"].lower() or (i["slot"] == slot and "brunch" not in i["name"].lower()):
            return True
    return False


def finish(items: list[dict], *, days: int, destination: str, origin_city: str = "") -> list[dict]:
    """What the plan always needs, added by rule so it does not depend on the AI remembering: the
    flight in and out with the airport transfers, the hotel check-out, and a meal at each mealtime
    of every day. They are suggestions in general words: no times, prices or venue names."""
    where = destination or "your destination"
    home = origin_city or "home"
    out = list(items)

    def add(name, kind, day, slot, note, rank=None):
        item = _item(name, kind, day, slot, origin="suggested", note=note)
        item["rank"] = rank
        out.append(item)

    if days >= 2 and not any(i["kind"] == "stay" for i in out):
        add(f"Stay in {where}", "stay", 1, "afternoon",
            "Check in and settle in.", rank=-1)  # fmt: skip
    if days >= 2:
        add(f"Fly {home} to {where}" if origin_city else f"Fly to {where}", "travel", 1,
            "morning", "Flight times and fares are on the trip page.", rank=-3)  # fmt: skip
        add("Airport to your stay", "travel", 1, "afternoon",
            "A pre-booked car or a taxi from the airport.", rank=-2)  # fmt: skip
        for i in out:  # arriving in the morning, so check-in is for the afternoon
            if i["kind"] == "stay" and i["day"] == 1:
                i["slot"] = "afternoon"
        add("Check out", "note", days, "morning",
            "Leave your bags with the hotel if your flight is later.", rank=-1)  # fmt: skip
        add("Your stay to the airport", "travel", days, "afternoon",
            "Leave plenty of time for check-in and security.", rank=8)  # fmt: skip
        add(f"Fly back to {home}" if origin_city else "Fly home", "travel", days, "evening",
            "Flight times and fares are on the trip page.", rank=9)  # fmt: skip
    for d in range(1, days + 1):
        near = {
            slot: next(
                (i["name"] for i in items if i["day"] == d and i["slot"] == slot and _is_main(i)),
                None,
            )
            for slot in SLOTS
        }
        for word, slot, label in MEALS:
            if days >= 2 and ((d == 1 and word == "breakfast") or (d == days and word == "dinner")):
                continue
            if _meal_in(out, d, word, slot):
                continue
            where_to = near[slot] or next((n for n in near.values() if n), None)
            note = f"A local place near {where_to}." if where_to else "A local place nearby."
            add(label, "food", d, slot, note)
    out.sort(key=lambda i: (i["day"], _rank(i), SLOTS.index(i["slot"])))
    return out


MEAL_PROMPT = """You suggest what to eat on a trip. For each meal in "meals", name a dish or a
cuisine the destination is really known for, and the area to eat it in, near the activity given.
Never name a restaurant, and give no prices. "area" is a district or neighbourhood only, never an
activity or a sight. Fit the group ("planning_for": a couple might get a
romantic dinner, a family kid-friendly food, older travellers easy-to-eat food). Vary the dishes
across days.
Return JSON only:
{"meals": [{"day": 1, "meal": "lunch", "dish": "Goan fish thali", "area": "Baga"}]}"""


async def name_meals(
    ai: AIOrchestrator, task: str, items: list[dict], *, destination: str, for_persona: str
) -> list[dict]:
    """Turn the plain "Lunch: a local place near X" entries into a dish and an area ("Lunch: Goan
    fish thali in Baga"), in one small AI call. Whatever goes wrong, the plain entries stay."""
    plain = [
        i for i in items if i["kind"] == "food" and i["name"] in ("Breakfast", "Lunch", "Dinner")
    ]
    if not plain:
        return items
    asked = []
    for i in plain:
        near = [
            o["name"]
            for o in items
            if o["day"] == i["day"] and o["kind"] in ("sight", "experience", "area")
        ]
        asked.append({"day": i["day"], "meal": i["name"].lower(), "near": near[:3]})
    try:
        raw = await ai.complete(
            task,
            [
                {"role": "system", "content": MEAL_PROMPT},
                {"role": "user", "content": json.dumps(
                    {"destination": destination, "planning_for": for_persona, "meals": asked},
                    ensure_ascii=False)},
            ],
            json_mode=True, temperature=0.4, max_tokens=1500,
        )  # fmt: skip
        named = parse_json_object(raw).get("meals") or []
    except Exception:  # noqa: BLE001 - the plain entries are fine
        log.warning("naming the meals failed", exc_info=True)
        return items
    by_key = {
        (m.get("day"), str(m.get("meal", "")).lower()): m for m in named if isinstance(m, dict)
    }
    for i in plain:
        m = by_key.get((i["day"], i["name"].lower()))
        dish = re.sub(r"\s+", " ", str((m or {}).get("dish") or "")).strip()
        area = re.sub(r"\s+", " ", str((m or {}).get("area") or "")).strip()
        near = [
            n.lower()
            for n in next(
                (
                    a["near"]
                    for a in asked
                    if a["day"] == i["day"] and a["meal"] == i["name"].lower()
                ),
                [],
            )
        ]
        if any(n in area.lower() or area.lower() in n for n in near if area):
            area = ""  # the model gave the activity back as the place: say only the dish
        if dish and not re.search(r"[₹$€£]|\d", dish):
            i["name"] = f"{i['name']}: {dish}" + (f" in {area}" if area else "")
    return items


async def build(
    ai: AIOrchestrator | None,
    *,
    must: list[dict],
    destination: str,
    days: int,
    adults: int,
    kids: int,
    seniors: int,
    pace: str,
    when: str,
    group: str,
    summary: str = "",
    origin_city: str = "",
    reel_tips: list[str] | None = None,
    domestic: bool | None = None,
) -> dict[str, Any]:
    """The plan: {items, summary, tips, persona, ai_built}."""
    days = max(1, min(MAX_DAYS, days))
    who = persona(group, adults, kids, seniors)
    if ai is not None and ai.enabled and must:
        context = facts(
            destination=destination, days=days, adults=adults, kids=kids, seniors=seniors,
            pace=pace, when=when, group=group, for_persona=who, summary=summary, must=must,
            origin_city=origin_city, reel_tips=reel_tips, domestic=domestic,
        )  # fmt: skip
        facts_text = json.dumps(context, ensure_ascii=False)
        messages = [
            {"role": "system", "content": f"{rules(who)}\n\n{CONTRACT}"},
            {"role": "user", "content": f"Facts:\n{facts_text}"},
        ]
        cleaned = None
        try:  # a faster model and no long thinking, where the provider has one set up for this
            task = "builder" if ai.supports("builder") else "planner"
        except AttributeError:
            task = "planner"
        thin_first = None  # a usable plan whose middle days are bare, kept in case the redo fails
        for attempt in range(2):  # the model provider is sometimes at capacity: once more
            try:
                raw = await ai.complete(
                    task, messages, json_mode=True, temperature=0.3, max_tokens=4000
                )
                cleaned = clean(parse_json_object(raw), must, days)
                if cleaned is not None:
                    bare = thin_days(cleaned[0], days)
                    log.info("trip build try %s: days with too little to do: %s", attempt + 1, bare)
                    if (
                        attempt == 1
                        and thin_first is not None
                        and len(bare) > len(thin_days(thin_first[0], days))
                    ):
                        cleaned = thin_first  # the redo is thinner than the first plan: keep that
                    if not bare or attempt == 1:
                        break
                    thin_first, cleaned = cleaned, None
                    messages = [*messages, {"role": "assistant", "content": raw}, {
                        "role": "user", "content": (
                            f"Day {', '.join(map(str, bare))} has too little to do. Every day "
                            "except the first and last needs at least two things to see or do, "
                            "besides meals: add well-known real places or general suggestions "
                            'near the others, marked "optional": true. Do not repeat a place that '
                            "is already in the plan, and keep every must_include place. Answer "
                            "again with the whole plan as JSON only."
                        )}]  # fmt: skip
                    continue
                messages = [*messages, {"role": "user", "content": (
                    f"That plan was not usable: it must cover all {days} days, each with at least "
                    "one sight or experience, and include every must_include place once. "
                    "Share the places out over all the days and answer again with JSON only."
                )}]  # fmt: skip
            except Exception:  # noqa: BLE001 - the AI being down means an arranged trip
                log.warning("AI trip build failed (try %s)", attempt + 1, exc_info=True)
                if attempt == 0:
                    await asyncio.sleep(RETRY_SECONDS)
        cleaned = cleaned or thin_first
        if cleaned is not None:
            items, text, tips = cleaned
            items = finish(items, days=days, destination=destination, origin_city=origin_city)
            items = await name_meals(ai, task, items, destination=destination, for_persona=who)
            return {
                "items": items,
                "summary": text,
                "tips": tips,
                "persona": who,
                "ai_built": True,
            }
    return {
        "items": finish(
            arrange(must, days), days=days, destination=destination, origin_city=origin_city
        ),
        "summary": "",
        "tips": [],
        "persona": who,
        "ai_built": False,
    }
