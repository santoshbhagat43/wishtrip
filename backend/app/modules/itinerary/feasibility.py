"""Deterministic feasibility engine: the backend, not the LLM, decides whether a plan works.

The planner proposes days of suggestions. This module schedules each day (start times,
travel between stops), checks it against facts and the traveler's constraints, repairs what
it can (move, re-time, drop, refill from other retrieved candidates) and reports the rest.

Pure functions only — no database, no LLM — so every rule is unit-testable.
"""

from __future__ import annotations

import math
import re
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.modules.knowledge.models import Location

# Minutes of sightseeing + travel a day can hold, by traveler energy (1 relaxed … 5 active).
ENERGY_CAPACITY = {1: 300, 2: 360, 3: 480, 4: 540, 5: 600}
DEFAULT_CAPACITY = 480
# Fallback durations when the knowledge base has none (marked as estimates in the output).
TYPE_DURATION = {
    "attraction": 90,
    "experience": 120,
    "activity": 180,
    "restaurant": 75,
    "route": 120,
    "hotel": 0,
    "flight": 0,
    "city": 0,
    "country": 0,
}
DEFAULT_DURATION = 90
SLOTS = {  # time-of-day windows, minutes from midnight
    "morning": (8 * 60, 12 * 60),
    "afternoon": (12 * 60, 17 * 60),
    "evening": (17 * 60, 21 * 60),
    "night": (20 * 60, 24 * 60 - 1),
}
SLOT_ORDER = {"morning": 0, None: 1, "afternoon": 2, "evening": 3, "night": 4}
WINDOW_GRACE = 60  # an item may run this far past its slot before we flag it
LONG_TRANSFER = 120
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
FILL_PER_EMPTY_DAY = 2


@dataclass
class Constraints:
    duration_days: int | None = None
    energy_level: int | None = None
    budget_level: int | None = None
    companions: str | None = None
    accessibility_needs: bool = False
    start_date: date | None = None

    @property
    def capacity(self) -> int:
        return ENERGY_CAPACITY.get(self.energy_level or 0, DEFAULT_CAPACITY)

    @property
    def day_start(self) -> int:
        return 9 * 60 + (30 if (self.energy_level or 3) <= 2 else 0)


@dataclass
class Issue:
    severity: str  # "blocking" | "warning" | "info"
    code: str
    message: str
    day: int | None = None
    name: str | None = None


@dataclass
class PlanItem:
    suggestion: dict[str, Any]
    location: Location | None

    @property
    def name(self) -> str:
        return self.suggestion["name"]

    @property
    def day(self) -> int:
        return self.suggestion["day"]

    @property
    def placeholder(self) -> bool:
        return bool(self.suggestion.get("is_placeholder"))

    @property
    def duration(self) -> tuple[int, bool]:
        """(minutes, estimated?) — knowledge-base durations are facts, the rest estimates."""
        if self.location is not None and self.location.duration_minutes is not None:
            return self.location.duration_minutes, False
        kind = self.suggestion.get("type") or ""
        return TYPE_DURATION.get(kind, DEFAULT_DURATION), True


@dataclass
class Result:
    status: str  # "feasible" | "repaired" | "needs_attention" | "not_applicable"
    suggestions: list[dict[str, Any]]
    days: list[dict[str, Any]] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    changes: list[str] = field(default_factory=list)

    def report(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "changes": self.changes,
            "issues": [issue.__dict__ for issue in self.issues],
        }


# Facts ------------------------------------------------------------------------------------


def clock(minutes: int) -> str:
    minutes = max(0, min(minutes, 24 * 60 - 1))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def parse_clock(text: str) -> int | None:
    m = re.match(r"\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$", text, re.I)
    if not m:
        return None
    hours, mins = int(m.group(1)), int(m.group(2) or 0)
    if m.group(3):
        hours = hours % 12 + (12 if m.group(3).lower() == "pm" else 0)
    return hours * 60 + mins


def opening(
    location: Location | None, weekday: str | None
) -> tuple[bool | None, tuple[int, int] | None]:
    """(open on that weekday?, (opens, closes) if known). None means we don't know."""
    hours = (location.opening_hours or {}) if location is not None else {}
    if not hours or weekday is None:
        return None, None
    open_days = hours.get("open_days")
    allowed = (
        set(re.findall(r"[a-z]{3}", open_days.lower())) if isinstance(open_days, str) else None
    )
    if allowed is not None and weekday not in allowed:
        return False, None
    window = hours.get(weekday)
    if isinstance(window, str):
        if window.strip().lower() == "closed":
            return False, None
        parts = re.split(r"\s*[–-]\s*", window)
        if len(parts) == 2:
            opens, closes = parse_clock(parts[0]), parse_clock(parts[1])
            if opens is not None and closes is not None:
                return True, (opens, closes)
    return (True if allowed is not None else None), None


def restricted_days(location: Location | None) -> str | None:
    hours = (location.opening_hours or {}) if location is not None else {}
    open_days = hours.get("open_days")
    return open_days if isinstance(open_days, str) and open_days.strip() else None


def haversine_km(a: Location, b: Location) -> float | None:
    if None in (a.latitude, a.longitude, b.latitude, b.longitude):
        return None
    lat1, lon1, lat2, lon2 = map(math.radians, (a.latitude, a.longitude, b.latitude, b.longitude))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371 * 2 * math.asin(math.sqrt(h))


def travel(
    a: Location | None, b: Location | None, relations: dict[tuple[uuid.UUID, uuid.UUID], int]
) -> tuple[int, bool]:
    """(minutes, estimated?) between two stops. Stored relations beat distance guesses —
    straight-line distance can't see a ridge or a river."""
    if a is None or b is None:
        return 20, True
    if a.id == b.id:
        return 0, False
    if (minutes := relations.get((a.id, b.id))) is not None:
        return minutes, False
    same_city = a.parent_id == b.parent_id
    city_route = (
        relations.get((a.parent_id, b.parent_id))
        if not same_city and a.parent_id and b.parent_id
        else None
    )
    if city_route is not None:
        return city_route + 20, True  # city-to-city route plus getting to/from the stops
    km = haversine_km(a, b)
    if km is None:
        return (20 if same_city else 180), True
    if km <= 5:
        return round(10 + km * 3), True  # ~20 km/h in town, plus getting going
    # Longer hops are mostly road: ~40 km/h door to door, plus 20 min to get going/park.
    return round(20 + km * 1.5), True


def hard_constraint_violation(location: Location | None, c: Constraints) -> str | None:
    if location is None:
        return None
    if c.accessibility_needs and location.accessible is False:
        return "isn't wheelchair accessible"
    if c.companions == "family" and location.family_friendly is False:
        return "isn't suitable for families"
    if (
        c.budget_level is not None
        and location.cost_level is not None
        and location.cost_level > c.budget_level + 1
    ):
        return "is well above your budget"
    return None


# Engine -----------------------------------------------------------------------------------


def _weekday(c: Constraints, day: int) -> tuple[str | None, date | None]:
    if c.start_date is None:
        return None, None
    on = c.start_date + timedelta(days=day - 1)
    return WEEKDAYS[on.weekday()], on


def _ordered(items: list[PlanItem]) -> list[PlanItem]:
    return sorted(items, key=lambda i: SLOT_ORDER.get(i.suggestion.get("time_of_day"), 1))


def is_meal(item: PlanItem) -> bool:
    return item.suggestion.get("type") == "restaurant"


def real_load(items: list[PlanItem], relations: dict) -> int:
    """Sightseeing + actual travel minutes for a day, in scheduled order. Meals take clock
    time but don't use up the day's sightseeing capacity — people eat whatever the plan."""
    total, previous = 0, None
    for item in _ordered(items):
        if previous is not None:
            total += travel(previous.location, item.location, relations)[0]
        if not is_meal(item):
            total += item.duration[0]
        if not item.placeholder:
            previous = item
    return total


def schedule_day(
    day: int, items: list[PlanItem], c: Constraints, relations: dict
) -> tuple[dict[str, Any], list[Issue]]:
    weekday, on = _weekday(c, day)
    issues: list[Issue] = []
    ordered = _ordered(items)
    now, previous, rows = c.day_start, None, []
    active = travel_total = meals = 0
    for item in ordered:
        minutes, estimated = item.duration
        hop, hop_estimated = (
            (0, False) if previous is None else travel(previous.location, item.location, relations)
        )
        if hop >= LONG_TRANSFER:
            issues.append(
                Issue(
                    "warning",
                    "long_transfer",
                    f"About {hop} min to get from {previous.name} to {item.name}.",
                    day,
                    item.name,
                )
            )
        now += hop
        slot = item.suggestion.get("time_of_day")
        if slot in SLOTS:
            now = max(now, SLOTS[slot][0])
        _, window = opening(item.location, weekday)
        if window and now < window[0]:
            now = window[0]
        start, end = now, now + minutes
        if window and end > window[1]:
            issues.append(
                Issue(
                    "warning",
                    "closes_early",
                    f"{item.name} closes at {clock(window[1])}, before this visit would end.",
                    day,
                    item.name,
                )
            )
        if slot in SLOTS and end > SLOTS[slot][1] + WINDOW_GRACE:
            issues.append(
                Issue(
                    "warning",
                    "runs_late",
                    f"{item.name} would run until {clock(end)}, past the {slot}.",
                    day,
                    item.name,
                )
            )
        if weekday is None and (days := restricted_days(item.location)):
            issues.append(
                Issue(
                    "info",
                    "open_days",
                    f"{item.name} is only open on: {days}. Pick dates that fit.",
                    day,
                    item.name,
                )
            )
        rows.append(
            {
                **item.suggestion,
                "day": day,
                "start": clock(start),
                "end": clock(end),
                "duration_minutes": None if item.placeholder else minutes,
                "duration_estimated": estimated and not item.placeholder,
                "travel_minutes_before": hop,
                "travel_estimated": hop_estimated,
            }
        )
        if is_meal(item):
            meals += minutes
        else:
            active += minutes
        travel_total += hop
        now = end
        if not item.placeholder:
            previous = item
    load = active + travel_total
    if load > c.capacity:
        issues.append(
            Issue(
                "blocking",
                "overloaded",
                f"Day {day} needs about {load} min but fits {c.capacity} min at this pace.",
                day,
            )
        )
    return {
        "day": day,
        "date": on.isoformat() if on else None,
        "weekday": weekday,
        "capacity_minutes": c.capacity,
        "activity_minutes": active,
        "meal_minutes": meals,
        "travel_minutes": travel_total,
        "items": rows,
    }, issues


def check_and_repair(
    suggestions: list[dict[str, Any]],
    locations: dict[str, Location],
    pool: list[Location],
    relations: dict[tuple[uuid.UUID, uuid.UUID], int],
    c: Constraints,
) -> Result:
    """Schedule, check and repair a day-by-day plan. Undated suggestions pass through."""
    if not any(isinstance(s.get("day"), int) for s in suggestions):
        return Result("not_applicable", suggestions)

    undated = [s for s in suggestions if not isinstance(s.get("day"), int)]
    items = [
        PlanItem(s, locations.get(s["location_id"]) if s.get("location_id") else None)
        for s in suggestions
        if isinstance(s.get("day"), int)
    ]
    changes: list[str] = []
    trip_days = c.duration_days or max(i.day for i in items)
    days: dict[int, list[PlanItem]] = {d: [] for d in range(1, trip_days + 1)}

    def relocate(item: PlanItem, reason: str, exclude: int | None = None) -> bool:
        """Move an item to the open day with the most spare room; True if it found one."""
        options = []
        for d, day_items in days.items():
            if d == exclude:
                continue
            weekday, _ = _weekday(c, d)
            if opening(item.location, weekday)[0] is False:
                continue
            if real_load([*day_items, item], relations) <= c.capacity:
                options.append((real_load(day_items, relations), d))
        if not options:
            return False
        _, target = min(options)
        item.suggestion = {**item.suggestion, "day": target}
        days[target].append(item)
        changes.append(f"Moved {item.name} to day {target} ({reason}).")
        return True

    seen: set[str] = set()
    for item in items:
        key = item.suggestion.get("location_id") or item.name.lower()
        if key in seen:
            changes.append(f"Removed a duplicate visit to {item.name}.")
            continue
        seen.add(key)
        if (why := hard_constraint_violation(item.location, c)) is not None:
            changes.append(f"Removed {item.name} — it {why}.")
            continue
        best = (item.location.best_times or []) if item.location is not None else []
        slot = item.suggestion.get("time_of_day")
        if best and slot and slot not in best:
            item.suggestion = {**item.suggestion, "time_of_day": best[0]}
            changes.append(
                f"Moved {item.name} to the {best[0]} — it's best then, not in the {slot}."
            )
        if item.day > trip_days:
            if not relocate(item, f"the trip is {trip_days} days"):
                changes.append(f"Removed {item.name} — there's no room in a {trip_days}-day trip.")
            continue
        weekday, on = _weekday(c, item.day)
        if opening(item.location, weekday)[0] is False:
            reason = f"it's closed on {on:%A}" if on else "it's closed that day"
            if not relocate(item, reason, exclude=item.day):
                changes.append(f"Removed {item.name} — it's closed on every day it would fit.")
            continue
        days[item.day].append(item)

    # Overloaded days: move the least important stops (non-highlights, added last) elsewhere.
    for d in list(days):
        while real_load(days[d], relations) > c.capacity and len(days[d]) > 1:
            victim = min(
                reversed(days[d]),
                key=lambda i: (bool(i.location and i.location.highlight), -days[d].index(i)),
            )
            days[d].remove(victim)
            if not relocate(victim, f"day {d} was too full", exclude=d):
                changes.append(
                    f"Removed {victim.name} — day {d} was too full and no other day had room."
                )

    # Re-retrieve and repair: refill days left empty with other candidates that pass the checks.
    used = {i.location.id for day_items in days.values() for i in day_items if i.location}
    for d, day_items in days.items():
        if day_items:
            continue
        weekday, _ = _weekday(c, d)
        for candidate in pool:
            if len(days[d]) >= FILL_PER_EMPTY_DAY:
                break
            if candidate.id in used or hard_constraint_violation(candidate, c):
                continue
            if opening(candidate, weekday)[0] is False:
                continue
            filler = PlanItem(
                {
                    "name": candidate.name,
                    "type": candidate.type.value,
                    "location_id": str(candidate.id),
                    "from_knowledge_base": True,
                    "is_placeholder": False,
                    "day": d,
                    "time_of_day": (candidate.best_times or [None])[0],
                    "duration_minutes": candidate.duration_minutes,
                    "price": candidate.price_note or None,
                    "why": "Added by the plan check so this day isn't empty.",
                },
                candidate,
            )
            if real_load([*days[d], filler], relations) > c.capacity:
                continue
            days[d].append(filler)
            used.add(candidate.id)
            changes.append(f"Added {candidate.name} to day {d}, which was empty.")

    scheduled, issues = [], []
    for d, day_items in days.items():
        plan, day_issues = schedule_day(d, day_items, c, relations)
        scheduled.append(plan)
        issues += day_issues
    estimated = [
        i.name
        for day_items in days.values()
        for i in day_items
        if i.duration[1] and not i.placeholder
    ]
    if estimated:
        more = "…" if len(estimated) > 5 else ""
        issues.append(
            Issue(
                "info",
                "estimated_durations",
                f"Durations are estimates for: {', '.join(estimated[:5])}{more}.",
            )
        )

    blocking = any(i.severity == "blocking" for i in issues)
    status = "needs_attention" if blocking else ("repaired" if changes else "feasible")
    final = [row for plan in scheduled for row in plan["items"]] + undated
    return Result(status, final, scheduled, issues, changes)
