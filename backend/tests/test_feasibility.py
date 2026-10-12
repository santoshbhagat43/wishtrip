import uuid
from datetime import date

from app.modules.itinerary.feasibility import Constraints, check_and_repair, opening, travel
from app.modules.knowledge.models import Location, LocationType

CITY = uuid.uuid4()
OTHER_CITY = uuid.uuid4()


def place(
    name, *, minutes=60, type_=LocationType.ATTRACTION, parent=CITY, lat=51.50, lng=-0.12, **kw
):
    return Location(
        id=uuid.uuid4(),
        name=name,
        type=type_,
        parent_id=parent,
        duration_minutes=minutes,
        latitude=lat,
        longitude=lng,
        best_times=kw.pop("best_times", []),
        opening_hours=kw.pop("opening_hours", {}),
        price_note="",
        **kw,
    )


def plan(*entries):
    """entries: (location, day, time_of_day)"""
    return [
        {
            "name": loc.name,
            "type": loc.type.value,
            "location_id": str(loc.id),
            "from_knowledge_base": True,
            "is_placeholder": False,
            "day": day,
            "time_of_day": slot,
            "duration_minutes": None,
            "price": None,
            "why": "",
        }
        for loc, day, slot in entries
    ]


def run(entries, c=None, pool=(), relations=None):
    locs = {str(loc.id): loc for loc, *_ in entries} | {str(p.id): p for p in pool}
    return check_and_repair(plan(*entries), locs, list(pool), relations or {}, c or Constraints())


def names(result, day):
    return [i["name"] for d in result.days if d["day"] == day for i in d["items"]]


def test_plans_without_days_are_not_checked():
    loc = place("Tower")
    s = plan((loc, 1, None))
    s[0]["day"] = None
    result = check_and_repair(s, {str(loc.id): loc}, [], {}, Constraints())
    assert result.status == "not_applicable"
    assert result.suggestions == s


def test_feasible_day_is_scheduled_with_stored_travel_times():
    a, b = place("Tower Bridge", minutes=90), place("Borough Market", minutes=120)
    result = run(
        [(a, 1, "morning"), (b, 1, "afternoon")], relations={(a.id, b.id): 15, (b.id, a.id): 15}
    )
    assert result.status == "feasible"
    first, second = result.days[0]["items"]
    assert (first["start"], first["end"]) == ("09:00", "10:30")
    assert second["travel_minutes_before"] == 15 and second["travel_estimated"] is False
    assert second["start"] == "12:00"  # waits for the afternoon window
    assert result.days[0]["travel_minutes"] == 15


def test_travel_estimates_from_distance_and_city_routes():
    a = place("A", lat=51.500, lng=-0.120)
    b = place("B", lat=51.510, lng=-0.130)  # ~1.3 km
    minutes, estimated = travel(a, b, {})
    assert estimated and 12 <= minutes <= 16
    far = place("Far", parent=OTHER_CITY, lat=51.75, lng=-1.26)
    via_route, est = travel(a, far, {(CITY, OTHER_CITY): 90})
    assert (via_route, est) == (110, True)  # stored city route + getting to/from the stops


def test_wrong_time_of_day_is_moved_to_the_best_time():
    sunset = place("Sky Garden", best_times=["evening"])
    result = run([(sunset, 1, "morning")])
    assert result.status == "repaired"
    item = result.days[0]["items"][0]
    assert item["time_of_day"] == "evening" and item["start"] >= "17:00"
    assert "best then" in result.changes[0]


def test_best_time_move_is_undone_when_that_slot_is_already_full():
    # Two 2-hour morning stops can't both fit the morning; the second one moved there from the
    # afternoon would run past it, so it stays in the afternoon instead of a contradiction.
    first = place("Tea museum", minutes=150, best_times=["morning"])
    second = place("Spice garden", minutes=120, best_times=["morning"])
    result = run([(first, 1, "morning"), (second, 1, "afternoon")])
    assert result.status == "feasible" and result.changes == []
    assert not [i for i in result.issues if i.code == "runs_late"]
    assert result.days[0]["items"][1]["time_of_day"] == "afternoon"


def test_overloaded_day_moves_the_least_important_stop():
    must = place("Grand Palace", minutes=180, highlight=True)
    extra1, extra2 = place("Museum", minutes=180), place("Market", minutes=180)
    result = run(
        [(must, 1, None), (extra1, 1, None), (extra2, 1, None)],
        c=Constraints(duration_days=2, energy_level=2),
    )  # 360 min/day
    assert result.status == "repaired"
    assert "Grand Palace" in names(result, 1)
    assert len(names(result, 1)) == 1 and len(names(result, 2)) == 1
    assert any("Removed" in c for c in result.changes)  # the third can't fit anywhere
    assert all(d["activity_minutes"] + d["travel_minutes"] <= 360 for d in result.days)


def test_days_beyond_the_trip_are_relocated():
    a, b = place("A"), place("B")
    result = run([(a, 1, None), (b, 5, None)], c=Constraints(duration_days=2))
    assert [d["day"] for d in result.days] == [1, 2]
    assert "B" in names(result, 2)
    assert "the trip is 2 days" in result.changes[0]


def test_closed_weekday_is_moved_when_dates_are_known():
    market = place("Anjuna flea market", opening_hours={"open_days": "wed"})
    monday = date(2026, 11, 2)
    result = run([(market, 1, None)], c=Constraints(duration_days=3, start_date=monday))
    assert names(result, 3) == ["Anjuna flea market"]
    assert result.days[2]["weekday"] == "wed" and result.days[2]["date"] == "2026-11-04"
    assert "closed on Monday" in result.changes[0]


def test_restricted_days_without_dates_become_a_note():
    market = place("Anjuna flea market", opening_hours={"open_days": "wed"})
    result = run([(market, 1, None)])
    assert result.status == "feasible"
    assert any(i.code == "open_days" for i in result.issues)


def test_opening_window_shifts_start_and_flags_early_closing():
    museum = place("Museum", minutes=180, opening_hours={"mon": "10:00–12:00"})
    assert opening(museum, "mon") == (True, (600, 720))
    assert opening(place("X", opening_hours={"tue": "closed"}), "tue") == (False, None)
    result = run([(museum, 1, "morning")], c=Constraints(start_date=date(2026, 11, 2)))
    item = result.days[0]["items"][0]
    assert item["start"] == "10:00"
    assert any(i.code == "closes_early" for i in result.issues)


def test_hard_constraints_remove_and_empty_days_are_refilled():
    steps = place("Montmartre steps", accessible=False)
    fallback = place("Seine cruise", accessible=True, best_times=["evening"])
    result = run([(steps, 1, "morning")], c=Constraints(accessibility_needs=True), pool=[fallback])
    assert names(result, 1) == ["Seine cruise"]
    assert any("wheelchair" in c for c in result.changes)
    assert any("which was empty" in c for c in result.changes)


def test_duplicates_are_removed():
    a = place("Tower")
    result = run([(a, 1, None), (a, 2, None)])
    assert sum(len(d["items"]) for d in result.days) == 1
    assert "duplicate" in result.changes[0]


def test_unfixable_overload_needs_attention():
    marathon = place("Full-day trek", minutes=600)
    result = run([(marathon, 1, None)], c=Constraints(energy_level=1))
    assert result.status == "needs_attention"
    assert any(i.severity == "blocking" and i.code == "overloaded" for i in result.issues)


def test_estimated_durations_and_placeholders():
    unknown = place("No duration yet", minutes=None, type_=LocationType.ACTIVITY)
    entries = plan((unknown, 1, None))
    entries.append(
        {
            "name": "Sample hotel option",
            "type": "hotel",
            "location_id": None,
            "from_knowledge_base": False,
            "is_placeholder": True,
            "day": 1,
            "time_of_day": None,
            "duration_minutes": None,
            "price": None,
            "why": "",
        }
    )
    result = check_and_repair(entries, {str(unknown.id): unknown}, [], {}, Constraints())
    rows = result.days[0]["items"]
    assert rows[0]["duration_minutes"] == 180 and rows[0]["duration_estimated"] is True
    assert rows[1]["is_placeholder"] and rows[1]["duration_minutes"] is None
    assert any(i.code == "estimated_durations" for i in result.issues)


def test_seniors_are_not_treated_as_families_with_children():
    market = place("Flea market", family_friendly=False)
    assert names(run([(market, 1, None)], c=Constraints(companions="seniors")), 1) == [
        "Flea market"
    ]
    assert names(run([(market, 1, None)], c=Constraints(companions="family")), 1) == []


def test_long_hops_use_road_speed_not_town_speed():
    a = place("Spice farm", lat=15.40, lng=74.00)
    b = place("Palolem", lat=15.01, lng=74.02)  # ~43 km, same region
    minutes, estimated = travel(a, b, {})
    assert estimated and 75 <= minutes <= 95


def test_repairs_count_real_travel_not_a_flat_gap():
    """Regression (live Goa run): a move must not overfill the target day once travel is added."""
    north = place("North beach", minutes=120, lat=15.60, lng=73.74, best_times=["afternoon"])
    south = place("South cruise", minutes=120, lat=15.01, lng=74.02, best_times=["evening"])
    filler = place("North fort", minutes=150, lat=15.59, lng=73.75)
    extra = place("North cafe", minutes=150, lat=15.59, lng=73.76)
    result = run(
        [(north, 1, "afternoon"), (filler, 2, None), (extra, 2, None), (south, 2, "evening")],
        c=Constraints(duration_days=2, energy_level=1),
    )  # 300 min/day
    for d in result.days:
        assert d["activity_minutes"] + d["travel_minutes"] <= d["capacity_minutes"], d


def test_meals_take_time_but_not_sightseeing_capacity():
    sights = place("Tea museum", minutes=280)
    lunch = place("Tea-estate cafe", minutes=75, type_=LocationType.RESTAURANT)
    result = run(
        [(sights, 1, "morning"), (lunch, 1, "afternoon")], c=Constraints(energy_level=1)
    )  # 300
    assert result.status == "feasible"
    assert names(result, 1) == ["Tea museum", "Tea-estate cafe"]
    day = result.days[0]
    assert day["meal_minutes"] == 75 and day["activity_minutes"] == 280


# Preferred times of day ---------------------------------------------------------------------

EVENINGS = Constraints(energy_level=1, preferred_times=["evening"])  # 300 min a day


def test_overload_drops_a_daytime_stop_before_the_evening_the_traveler_wants():
    day1 = place("Boat cruise", minutes=180)
    lunch_walk = place("Garden walk", minutes=60)
    show = place("Kathakali show", minutes=90, best_times=["evening"])
    result = run(
        [(day1, 1, "morning"), (lunch_walk, 1, "afternoon"), (show, 1, "evening")], c=EVENINGS
    )
    assert "Kathakali show" in names(result, 1)
    assert "Garden walk" not in names(result, 1)


def test_missing_evening_is_filled_from_other_retrieved_places():
    morning = place("Tea museum", minutes=90)
    sunset = place("Sunset point", minutes=60, best_times=["evening"])
    result = run([(morning, 1, "morning")], c=EVENINGS, pool=[sunset])
    assert names(result, 1) == ["Tea museum", "Sunset point"]
    evening = result.days[0]["items"][1]
    assert evening["time_of_day"] == "evening" and evening["start"] >= "17:00"
    assert any("evening, as you asked" in ch for ch in result.changes)


def test_full_day_swaps_a_daytime_stop_for_an_evening_one():
    long_a, long_b = place("Dam visit", minutes=150), place("Viewpoint", minutes=120)
    sunset = place("Sunset walk", minutes=90, best_times=["evening"])
    result = run([(long_a, 1, "morning"), (long_b, 1, "afternoon")], c=EVENINGS, pool=[sunset])
    assert names(result, 1) == ["Dam visit", "Sunset walk"]
    assert any(ch.startswith("Swapped Viewpoint for Sunset walk") for ch in result.changes)
    assert result.status != "needs_attention"


def test_no_evening_place_is_said_not_invented():
    result = run([(place("Tea museum"), 1, "morning")], c=EVENINGS, pool=[place("Museum 2")])
    assert names(result, 1) == ["Tea museum"]
    assert any(i.code == "preferred_time_unfilled" for i in result.issues)


def test_unknown_wheelchair_access_is_flagged_not_assumed():
    known, unknown = place("Basilica", accessible=True), place("Island cycle ride")
    result = run(
        [(known, 1, "morning"), (unknown, 1, "afternoon")], c=Constraints(accessibility_needs=True)
    )
    flagged = [i for i in result.issues if i.code == "accessibility_unverified"]
    assert len(flagged) == 1 and "Island cycle ride" in flagged[0].message
    assert "Basilica" not in flagged[0].message
    # Travelers without that need aren't told.
    assert not [i for i in run([(unknown, 1, None)]).issues if i.code == "accessibility_unverified"]


def test_a_stop_added_to_an_empty_day_is_labelled_by_when_it_starts_not_flagged():
    # Both refills are best in the morning; the second can only start after noon, so it's an
    # afternoon stop — not "runs past the morning" about a time the plan check picked itself.
    kept = place("Tea museum", minutes=90)
    a = place("Top Station", minutes=150, best_times=["morning"])
    b = place("Tea factory", minutes=120, best_times=["morning"])
    result = run([(kept, 1, "morning")], c=Constraints(duration_days=2), pool=[a, b])
    assert names(result, 2) == ["Top Station", "Tea factory"]
    assert result.days[1]["items"][1]["time_of_day"] == "afternoon"
    assert not [i for i in result.issues if i.code == "runs_late"]
