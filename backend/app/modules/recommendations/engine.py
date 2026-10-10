"""Recommendation pipeline (dev.md §11), pure logic with no database access:

    Traveler Profile -> Preference Engine -> Candidate Search -> Ranking Engine

The database says what exists; this module decides what is relevant. The LLM only
explains and combines what comes out of here — it is never the source of truth.
"""

import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field

from app.modules.knowledge.models import Location
from app.modules.profiles.models import Companions, EventType, ProfileEvent, TravelerProfile

EVENT_WEIGHTS = {
    EventType.VIEWED: 0.1,
    EventType.SELECTED: 0.5,
    EventType.ADDED: 0.5,
    EventType.BOOKED: 0.8,
    EventType.SKIPPED: -0.4,
    EventType.REMOVED: -0.6,
}

RANKING_WEIGHTS = {
    "interest": 0.30,
    "semantic": 0.20,
    "energy": 0.15,
    "budget": 0.10,
    "companions": 0.10,
    "timing": 0.05,
    "affinity": 0.10,
}

NEUTRAL = 0.5
HIGHLIGHT_BONUS = 0.02


@dataclass
class Preferences:
    tag_weights: dict[uuid.UUID, float] = field(default_factory=dict)
    energy_level: int | None = None
    budget_level: int | None = None
    companions: Companions | None = None
    preferred_times: set[str] = field(default_factory=set)
    accessibility_needs: bool = False
    location_affinity: dict[uuid.UUID, float] = field(default_factory=dict)
    query_text: str = ""


@dataclass
class PreferenceOverrides:
    """Session-level signals (e.g. from chat intent) that win over the stored profile."""

    energy_level: int | None = None
    budget_level: int | None = None
    companions: Companions | None = None
    preferred_times: list[str] | None = None
    tag_ids: list[uuid.UUID] = field(default_factory=list)
    query_text: str = ""


@dataclass
class ScoredLocation:
    location: Location
    score: float
    components: dict[str, float]
    reasons: list[str]
    warnings: list[str]
    similarity: float | None = None


# Preference engine -------------------------------------------------------------------------


def build_preferences(
    profile: TravelerProfile | None,
    events: list[ProfileEvent],
    event_location_tags: dict[uuid.UUID, list[uuid.UUID]],
    interest_names: list[str],
    overrides: PreferenceOverrides | None = None,
) -> Preferences:
    prefs = Preferences()
    if profile:
        prefs.energy_level = profile.energy_level
        prefs.budget_level = profile.budget_level
        prefs.companions = profile.companions
        prefs.preferred_times = set(profile.preferred_times or [])
        prefs.accessibility_needs = profile.accessibility_needs
        for tag_id in profile.interest_tag_ids or []:
            prefs.tag_weights[tag_id] = 1.0

    # Behavior nudges both the individual location and the tags it carries.
    tag_weights: dict[uuid.UUID, float] = defaultdict(float, prefs.tag_weights)
    affinity: dict[uuid.UUID, float] = defaultdict(float)
    for event in events:
        weight = EVENT_WEIGHTS[event.event_type]
        affinity[event.location_id] += weight
        for tag_id in event_location_tags.get(event.location_id, []):
            tag_weights[tag_id] += weight * 0.5
    prefs.tag_weights = {k: v for k, v in tag_weights.items() if abs(v) > 1e-6}
    prefs.location_affinity = dict(affinity)

    text_parts = list(interest_names)
    if profile:
        text_parts += profile.travel_styles or []
        text_parts += profile.food_preferences or []

    if overrides:
        if overrides.energy_level is not None:
            prefs.energy_level = overrides.energy_level
        if overrides.budget_level is not None:
            prefs.budget_level = overrides.budget_level
        if overrides.companions is not None:
            prefs.companions = overrides.companions
        if overrides.preferred_times:
            prefs.preferred_times = set(overrides.preferred_times)
        for tag_id in overrides.tag_ids:
            prefs.tag_weights[tag_id] = max(prefs.tag_weights.get(tag_id, 0), 1.2)
        if overrides.query_text:
            text_parts.insert(0, overrides.query_text)

    prefs.query_text = ", ".join(p for p in text_parts if p)
    return prefs


def passes_hard_constraints(location: Location, prefs: Preferences) -> bool:
    """Filters that should never be traded off against a high score."""
    if prefs.accessibility_needs and location.accessible is False:
        return False
    if (
        prefs.budget_level is not None
        and location.cost_level is not None
        and location.cost_level > prefs.budget_level + 1
    ):
        return False
    return not (prefs.companions == Companions.FAMILY and location.family_friendly is False)


# Ranking engine ----------------------------------------------------------------------------


def _interest(location: Location, prefs: Preferences) -> float:
    if not prefs.tag_weights:
        return NEUTRAL
    total = sum(prefs.tag_weights.get(tag.id, 0.0) for tag in location.tags)
    # Squash an unbounded sum into 0..1, centred on neutral for "no overlap".
    return 1 / (1 + math.exp(-2 * total)) if total else 0.35


def _energy(location: Location, prefs: Preferences) -> float:
    if location.energy_level is None or prefs.energy_level is None:
        return NEUTRAL
    return 1 - abs(location.energy_level - prefs.energy_level) / 4


def _budget(location: Location, prefs: Preferences) -> float:
    if location.cost_level is None or prefs.budget_level is None:
        return NEUTRAL
    if location.cost_level <= prefs.budget_level:
        return 1.0
    return 0.4


def _companions(location: Location, prefs: Preferences) -> float:
    flag = (
        {
            Companions.FAMILY: location.family_friendly,
            Companions.COUPLE: location.couple_friendly,
        }.get(prefs.companions)
        if prefs.companions
        else None
    )
    if flag is None:
        return NEUTRAL
    return 1.0 if flag else 0.1


def _timing(location: Location, prefs: Preferences) -> float:
    if not prefs.preferred_times or not location.best_times:
        return NEUTRAL
    return 1.0 if prefs.preferred_times & set(location.best_times) else 0.3


def _affinity(location: Location, prefs: Preferences) -> float:
    value = prefs.location_affinity.get(location.id)
    if value is None:
        return NEUTRAL
    return max(0.0, min(1.0, NEUTRAL + value / 2))


def _semantic(similarity: float | None) -> float:
    return NEUTRAL if similarity is None else max(0.0, min(1.0, similarity))


REASON_TEXT = {
    "interest": ("matches your interests", "doesn't match your stated interests"),
    "semantic": ("closely matches what you described", None),
    "energy": ("fits your energy level", "energy level is far from your preference"),
    "budget": ("within your budget", "above your usual budget"),
    "companions": ("suits who you're travelling with", "not ideal for your travel group"),
    "timing": ("available at your preferred time of day", "best at a different time of day"),
    "affinity": ("similar to places you chose before", "you skipped or removed this before"),
}


def rank(
    candidates: list[tuple[Location, float | None]], prefs: Preferences, limit: int
) -> list[ScoredLocation]:
    scored: list[ScoredLocation] = []
    for location, similarity in candidates:
        components = {
            "interest": _interest(location, prefs),
            "semantic": _semantic(similarity),
            "energy": _energy(location, prefs),
            "budget": _budget(location, prefs),
            "companions": _companions(location, prefs),
            "timing": _timing(location, prefs),
            "affinity": _affinity(location, prefs),
        }
        score = sum(RANKING_WEIGHTS[k] * v for k, v in components.items())
        reasons, warnings = [], []
        if location.highlight:
            # Tie-breaker only: small enough that it can never outrank a hard constraint or a
            # clear preference mismatch (client lesson: tuning must not beat safety).
            score += HIGHLIGHT_BONUS
            reasons.append("a must-see highlight")
        for key, value in components.items():
            good, bad = REASON_TEXT[key]
            if value >= 0.75 and good:
                reasons.append(good)
            elif value <= 0.3 and bad:
                warnings.append(bad)
        scored.append(
            ScoredLocation(
                location=location,
                score=round(score, 4),
                components={k: round(v, 3) for k, v in components.items()},
                reasons=reasons,
                warnings=warnings,
                similarity=similarity,
            )
        )
    scored.sort(key=lambda s: s.score, reverse=True)
    return scored[:limit]
