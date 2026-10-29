"""A reel that says which day a place is on keeps it on that day."""

from app.modules.creators import builder
from app.modules.creators.trips import _item_from_place, assign_days
from app.modules.reels.understand import clean_reading, stated_day

TEXT = (
    "Day 1 we started at Fort Aguada and had lunch at Anjuna Shack. Day two was Old Goa churches "
    "and Fontainhas. On the third day Morjim beach and Chapora Fort. Day 4 Baga nightlife."
)


def place(name, day=None, kind="sight"):
    return {"name": name, "kind": kind, "evidence": name, "source": "voice", "day": day}


def test_a_day_is_kept_only_when_the_material_says_it():
    corpus = TEXT.lower()
    assert stated_day(1, corpus) == 1
    assert stated_day(2, corpus) == 2  # "day two"
    assert stated_day(3, corpus) == 3  # "third day"
    assert stated_day(4, corpus) == 4
    assert stated_day(5, corpus) is None  # the model's own idea: never said
    assert stated_day("2", corpus) == 2  # models answer "2" as often as 2
    assert stated_day("5", corpus) is None  # still only when the material says that day
    assert stated_day("two", corpus) is None
    assert stated_day(True, corpus) is None


def test_reading_keeps_the_days_the_creator_states():
    data = {"places": [place("Fort Aguada", 1), place("Fontainhas", 2), place("Baga", 6)]}
    reading = clean_reading(data, TEXT)
    days = {p["name"]: p["video_day"] for p in reading.places}
    assert days == {"Fort Aguada": 1, "Fontainhas": 2, "Baga": None}


def test_assign_days_puts_each_place_on_the_day_the_video_says():
    names = [
        ("Fort Aguada", 1),
        ("Anjuna Shack", None),
        ("Old Goa churches", 2),
        ("Fontainhas", None),
        ("Morjim beach", 3),
        ("Chapora Fort", None),
        ("Baga", 4),
    ]
    items = [_item_from_place({**place(n), "video_day": d}) for n, d in names]
    out = {i["name"]: i["day"] for i in assign_days(items, 3)}
    # An unnamed day sits with the place before it; the days run to the last one the video states.
    assert out == {
        "Fort Aguada": 1,
        "Anjuna Shack": 1,
        "Old Goa churches": 2,
        "Fontainhas": 2,
        "Morjim beach": 3,
        "Chapora Fort": 3,
        "Baga": 4,
    }


def test_without_stated_days_the_video_order_is_spread_evenly():
    items = [_item_from_place(place(f"Place {n}")) for n in range(6)]
    assert [i["day"] for i in assign_days(items, 3)] == [1, 1, 2, 2, 3, 3]


def test_the_builder_is_told_each_place_day_and_its_fallback_honours_it():
    must = [
        {"name": "Baga", "kind": "sight", "video_day": 2},
        {"name": "Fort Aguada", "kind": "sight", "video_day": 1},
        {"name": "Anjuna Shack", "kind": "food"},
    ]
    f = builder.facts(
        destination="Goa",
        days=3,
        adults=2,
        kids=0,
        seniors=0,
        pace="easy",
        when="",
        group="",
        for_persona="",
        summary="",
        must=must,
    )
    assert [m.get("day") for m in f["must_include"]] == [2, 1, None]
    placed = {i["name"]: i["day"] for i in builder.arrange(must, 3)}
    assert placed["Baga"] == 2 and placed["Fort Aguada"] == 1
