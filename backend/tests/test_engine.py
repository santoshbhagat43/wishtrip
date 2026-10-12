"""Recommendation engine rules (pure): preferences, hard constraints, ranking and reasons."""

import uuid

from app.modules.knowledge.models import Location, LocationType, Tag
from app.modules.profiles.models import Companions, EventType, ProfileEvent, TravelerProfile
from app.modules.recommendations.engine import (
    HIGHLIGHT_BONUS,
    PreferenceOverrides,
    Preferences,
    build_preferences,
    passes_hard_constraints,
    rank,
)

SCENIC, FOOD = Tag(id=uuid.uuid4(), name="Scenic"), Tag(id=uuid.uuid4(), name="Food")


def loc(name, tags=(), **kw):
    return Location(id=uuid.uuid4(), name=name, type=LocationType.ATTRACTION, tags=list(tags), **kw)


def test_behaviour_shifts_place_and_tag_weights():
    bridge, market = loc("Bridge", [SCENIC]), loc("Market", [FOOD])
    events = [
        ProfileEvent(location_id=bridge.id, event_type=EventType.BOOKED),
        ProfileEvent(location_id=market.id, event_type=EventType.SKIPPED),
        ProfileEvent(location_id=market.id, event_type=EventType.REMOVED),
    ]
    prefs = build_preferences(None, events, {bridge.id: [SCENIC.id], market.id: [FOOD.id]}, [])
    assert prefs.location_affinity[bridge.id] == 0.8
    assert prefs.location_affinity[market.id] == -1.0
    assert prefs.tag_weights[SCENIC.id] == 0.4 and prefs.tag_weights[FOOD.id] == -0.5


def test_session_overrides_win_over_the_stored_profile():
    profile = TravelerProfile(
        energy_level=4,
        budget_level=3,
        companions=Companions.SOLO,
        preferred_times=["morning"],
        interest_tag_ids=[SCENIC.id],
        travel_styles=["adventure"],
        food_preferences=[],
        accessibility_needs=False,
    )
    prefs = build_preferences(
        profile,
        [],
        {},
        ["Scenic"],
        PreferenceOverrides(
            energy_level=1,
            companions=Companions.SENIORS,
            preferred_times=["evening"],
            tag_ids=[FOOD.id],
            query_text="quiet sunsets",
        ),
    )
    assert (prefs.energy_level, prefs.budget_level, prefs.companions) == (1, 3, Companions.SENIORS)
    assert prefs.preferred_times == {"evening"}
    assert prefs.tag_weights[FOOD.id] == 1.2 and prefs.tag_weights[SCENIC.id] == 1.0
    assert prefs.query_text.startswith("quiet sunsets")


def test_hard_constraints():
    assert not passes_hard_constraints(
        loc("Steps", accessible=False), Preferences(accessibility_needs=True)
    )
    assert passes_hard_constraints(
        loc("Unknown access", accessible=None), Preferences(accessibility_needs=True)
    )
    assert not passes_hard_constraints(
        loc("Bar", family_friendly=False), Preferences(companions=Companions.FAMILY)
    )
    assert passes_hard_constraints(
        loc("Bar", family_friendly=False), Preferences(companions=Companions.SENIORS)
    )
    assert passes_hard_constraints(loc("A bit pricey", cost_level=2), Preferences(budget_level=1))
    assert not passes_hard_constraints(loc("Luxury", cost_level=3), Preferences(budget_level=1))


def test_unknown_facts_score_neutral_not_bad():
    scored = rank([(loc("Unknown"), None)], Preferences(energy_level=2, budget_level=1), limit=5)[0]
    assert set(scored.components.values()) == {0.5}
    assert scored.reasons == [] and scored.warnings == []


def test_ranking_order_reasons_and_warnings():
    prefs = Preferences(
        tag_weights={SCENIC.id: 1.0},
        energy_level=2,
        preferred_times={"evening"},
        companions=Companions.COUPLE,
    )
    good = loc(
        "Sunset point", [SCENIC], energy_level=2, best_times=["evening"], couple_friendly=True
    )
    poor = loc("Bootcamp", energy_level=5, best_times=["morning"], couple_friendly=False)
    first, second = rank([(poor, None), (good, 0.9)], prefs, limit=5)
    assert first.location.name == "Sunset point" and first.score > second.score
    assert {
        "matches your interests",
        "fits your energy level",
        "suits who you're travelling with",
    } <= set(first.reasons)
    assert "energy level is far from your preference" in second.warnings
    assert rank([(good, None), (poor, None)], prefs, limit=1)[0].location is good  # limit respected


def test_highlight_only_breaks_ties():
    twin_a, twin_b = loc("Plain"), loc("Highlight", highlight=True)
    a, b = rank([(twin_a, None), (twin_b, None)], Preferences(), limit=2)
    assert a.location is twin_b and round(a.score - b.score, 4) == HIGHLIGHT_BONUS
    # ...but never beats a clearly better match.
    prefs = Preferences(energy_level=1)
    calm, loud = loc("Calm", energy_level=1), loc("Loud highlight", energy_level=5, highlight=True)
    assert rank([(loud, None), (calm, None)], prefs, limit=2)[0].location is calm
