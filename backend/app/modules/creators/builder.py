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
KINDS = {"stay", "food", "sight", "experience", "area", "note"}
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
  are the fixed things: plan the days around them, grouping places that are close together.
- Each day has a morning, an afternoon and an evening part ("slot"). At most 3 main activities a
  day (sights and experiences that are not optional). Meals ("food") and rest or transfer notes
  ("note") do not count, and every day has breakfast, lunch and dinner suggestions, and rest time.
- Mark extra things as "optional": true. Anything you add that is not in must_include is
  "from_reel": false: only well-known real places or general suggestions (a beach walk, a local
  cafe), never an invented venue name, price, opening hour, address or phone number.
- A stay, if given, is checked in on day 1 and out on the last day ("stay" kind, in the note).
- "transfer": a few words on getting to the next stop ("about 20 min by car"), only when you
  are confident; otherwise leave it empty.
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
        "what_the_reel_is_about": summary,
        "must_include": [
            {"name": m["name"], "kind": m["kind"], "why": (m.get("note") or "")[:120]}
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
    # Every day has something to do: a day with no main activity means the days were not shared out.
    for d in range(1, days + 1):
        if not any(i["day"] == d and i["kind"] in ("sight", "experience", "area") for i in items):
            return None
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
    items.sort(key=lambda i: (i["day"], i["kind"] != "stay", SLOTS.index(i["slot"])))
    tips = [str(t).strip()[:300] for t in plan.get("tips") or [] if str(t).strip()][:8]
    return items, str(plan.get("summary") or "").strip()[:400], tips


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
) -> dict[str, Any]:
    """The plan: {items, summary, tips, persona, ai_built}."""
    days = max(1, min(MAX_DAYS, days))
    who = persona(group, adults, kids, seniors)
    if ai is not None and ai.enabled and must:
        context = facts(
            destination=destination, days=days, adults=adults, kids=kids, seniors=seniors,
            pace=pace, when=when, group=group, for_persona=who, summary=summary, must=must,
        )  # fmt: skip
        facts_text = json.dumps(context, ensure_ascii=False)
        messages = [
            {"role": "system", "content": f"{rules(who)}\n\n{CONTRACT}"},
            {"role": "user", "content": f"Facts:\n{facts_text}"},
        ]
        cleaned = None
        for attempt in range(2):  # the model provider is sometimes at capacity: once more
            try:
                raw = await ai.complete(
                    "planner", messages, json_mode=True, temperature=0.3, max_tokens=4000
                )
                cleaned = clean(parse_json_object(raw), must, days)
                if cleaned is not None:
                    break
                messages = [*messages, {"role": "user", "content": (
                    f"That plan was not usable: it must cover all {days} days, each with at least "
                    "one sight or experience, and include every must_include place once. "
                    "Share the places out over all the days and answer again with JSON only."
                )}]  # fmt: skip
            except Exception:  # noqa: BLE001 - the AI being down means an arranged trip
                log.warning("AI trip build failed (try %s)", attempt + 1, exc_info=True)
                if attempt == 0:
                    await asyncio.sleep(RETRY_SECONDS)
        if cleaned is not None:
            items, text, tips = cleaned
            return {"items": items, "summary": text, "tips": tips, "persona": who, "ai_built": True}
    return {
        "items": arrange(must, days),
        "summary": "",
        "tips": [],
        "persona": who,
        "ai_built": False,
    }
