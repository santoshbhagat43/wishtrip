"""Live TripJack prices for the stays of a traveller's trip, for its dates and party.

Only a stay that matches a TripJack hotel is priced, and only from TripJack's answer: a stay with
no match, no dates or no room says so, and is never given a number of ours."""

import asyncio
import datetime as dt
import logging
import re
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.creators import builder
from app.modules.creators import stays as stay_choice
from app.modules.creators.models import TravellerTrip
from app.modules.creators.stop_details import alternatives as nearest_hotels
from app.modules.hotels import matching, photos
from app.modules.hotels import service as hotel_search
from app.modules.hotels.client import (
    TripJackError,
    TripJackNotConfigured,
    new_correlation_id,
    tripjack_hotels,
)
from app.modules.hotels.models import SupplierHotel, SupplierRegion
from app.modules.hotels.pricing import IST, normalise_options
from app.modules.hotels.schemas import HotelSearch, Room
from app.modules.tripjack.cache import cache_get, cache_key, cache_set

log = logging.getLogger(__name__)

# How long a stay's price is kept before TripJack is asked again.
FRESH_SECONDS = 600
# Age TripJack is told for a child: the trip does not know it, so it is said on the page.
ASSUMED_CHILD_AGE = 8
PARALLEL = 4
# How many of the closest hotels are priced for a stay that matches none.
ALTERNATIVES = 3


class StayHotel(BaseModel):
    id: str
    name: str


class StayAlternative(BaseModel):
    """A hotel near what the stay's name looked like, priced for the same nights. Not the hotel the
    stay named: it is shown as a suggestion."""

    hotel: StayHotel
    stars: float | None = None
    image_url: str | None = None
    reason: str = ""
    total: float
    meal_basis: str = ""
    room: str = ""
    free_cancellation_until: str | None = None
    checked_at: str
    # How the party is roomed for this price ("2 adults", "1 adult + 2 children").
    rooms: list[str] = []


class StayPrice(BaseModel):
    item_id: str
    name: str
    # priced · unavailable (no room for these dates) · not_matched · no_dates · no_rooms (no way to
    # room this party that TripJack sells: a grown-up per room, at most four children) · error
    status: str
    hotel: StayHotel | None = None
    check_in: dt.date | None = None
    check_out: dt.date | None = None
    nights: int | None = None
    total: float | None = None
    meal_basis: str = ""
    room: str = ""
    free_cancellation_until: str | None = None
    checked_at: str | None = None
    # How the party is roomed for this price, one line per room.
    rooms: list[str] = []
    # When the stay's hotel has no room or is no hotel we hold: hotels that have a room, priced.
    # Suggestions only: the stay itself is never changed by a price check.
    alternatives: list[StayAlternative] = []


class StayPrices(BaseModel):
    currency: str
    stays: list[StayPrice]
    total: float
    checked_at: str | None = None
    rooms: int
    children_assumed_age: int | None = None
    all_priced: bool


# TripJack's limits for one room: at most four children, and a grown-up in every room. Four people
# is what an ordinary room sleeps; a family that needs more takes another room.
MAX_CHILDREN_PER_ROOM = 4
MAX_PEOPLE_PER_ROOM = 4


def room_plans(adults: int, kids: int) -> list[list[Room]]:
    """The ways to put the whole party in rooms TripJack can sell, fewest rooms first: two
    grown-ups to a room, the children spread to the emptiest rooms, every room with a grown-up and
    no room over four people or four children. Nobody is ever left out: when no way fits (one
    grown-up with five children), the list is empty and the stay says so. A family gets a second
    way with one more room, tried when the first has no room at a hotel."""
    if adults < 1:
        return []
    plans: list[list[Room]] = []
    for n in range(-(-adults // 2), adults + 1):
        rooms = [[0, 0] for _ in range(n)]
        for i in range(adults):
            rooms[i % n][0] += 1
        for _ in range(kids):
            room = min(rooms, key=lambda r: (r[0] + r[1], r[1]))
            room[1] += 1
        if any(c > MAX_CHILDREN_PER_ROOM for _, c in rooms):
            continue
        # Over four to a room only once every grown-up has a room of their own: then a family
        # room is the only way left.
        if n < adults and any(a + c > MAX_PEOPLE_PER_ROOM for a, c in rooms):
            continue
        plans.append([Room(adults=a, child_ages=[ASSUMED_CHILD_AGE] * c) for a, c in rooms])
        if not kids or len(plans) == 2:
            break
    return plans


def rooms_for(adults: int, kids: int) -> list[Room]:
    """The first way to room the party (see `room_plans`), or none when no way fits."""
    plans = room_plans(adults, kids)
    return plans[0] if plans else []


def describe(rooms: list[Room]) -> list[str]:
    """ "2 adults", "1 adult + 3 children": one line per room, for the page."""

    def one(room: Room) -> str:
        grown = f"{room.adults} {'adult' if room.adults == 1 else 'adults'}"
        kids = len(room.child_ages)
        return f"{grown} + {kids} {'child' if kids == 1 else 'children'}" if kids else grown

    return [one(r) for r in rooms]


def stay_nights(stays: list[dict], start: dt.date, days: int) -> dict[str, tuple[dt.date, dt.date]]:
    """Each stay is where the traveller sleeps from its day until the next stay (or the last day)."""
    last = start + dt.timedelta(days=max(0, days - 1))
    ordered = sorted(stays, key=lambda s: s.get("day") or 1)
    out: dict[str, tuple[dt.date, dt.date]] = {}
    for n, stay in enumerate(ordered):
        first = start + dt.timedelta(days=max(0, (stay.get("day") or 1) - 1))
        nxt = ordered[n + 1] if n + 1 < len(ordered) else None
        end = start + dt.timedelta(days=max(0, (nxt.get("day") or 1) - 1)) if nxt else last
        out[str(stay["id"])[:40]] = (first, end)
    return out


SHARED_ROOM = re.compile(r"dorm|shared|bunk|capsule|\bpod\b|bed in", re.I)


def _cheapest(options: list[dict]) -> dict | None:
    """The cheapest rate with a room of your own: a bed in a dormitory is not a room for a couple
    or a family, so it is not what a stay is priced at. (normalise_options sorts cheapest first.)"""
    for option in options:
        if not any(SHARED_ROOM.search(r.get("name") or "") for r in option.get("rooms") or []):
            return option
    return None


async def _price(hotel_id: str, check_in: dt.date, check_out: dt.date, rooms: list[Room]) -> dict:
    key = cache_key("stay", hotel_id, check_in, check_out, [r.to_tripjack() for r in rooms])
    cached = await cache_get(key)
    if cached:
        return cached
    body = await tripjack_hotels.pricing(
        hid=hotel_id,
        check_in=check_in.isoformat(),
        check_out=check_out.isoformat(),
        rooms=[r.to_tripjack() for r in rooms],
        correlation_id=new_correlation_id(),
    )
    found = {
        "option": _cheapest(normalise_options(body.get("options") or [])),
        "checked_at": datetime.now(IST).isoformat(),
    }
    await cache_set(key, found, FRESH_SECONDS)
    return found


async def _priced(
    hotel_id: str, window: tuple[dt.date, dt.date], plans: list[list[Room]]
) -> tuple[dict | None, list[Room] | None]:
    """The cheapest own-room rate for the first way of rooming the party this hotel has room for,
    and those rooms; (None, None) when it has none. Raises TripJackError."""
    for rooms in plans:
        got = await _price(hotel_id, *window, rooms)
        if got.get("option"):
            return got, rooms
    return None, None


def stay_town(stay: dict, destination: str) -> str:
    """Where a stay is: the town in "Stay in Thimphu" when we wrote it, else the trip's destination.
    A trip through several towns sleeps in each, and each is priced in its own town."""
    if stay.get("town"):  # a hotel the creator named, standing in for that town's stay
        return str(stay["town"])
    found = re.match(r"stay in\s+(.+)$", str(stay.get("name") or ""), re.I)
    return found.group(1).strip() if found and stay.get("origin") != "reel" else destination


async def _from_search(
    session: AsyncSession,
    mine: TravellerTrip,
    town: str,
    window: tuple[dt.date, dt.date],
    rooms: list[Room],
    stars: tuple[float, float],
    budget: bool,
    hostels: bool = False,
    country: str | None = None,
) -> SupplierHotel | None:
    """When we hold no hotels for the destination yet, ask TripJack what it can sell for these
    nights: the cheapest of the right class for a budget trip, else the best presented."""
    try:
        found = await hotel_search.search(
            session,
            HotelSearch(
                city=town, check_in=window[0], check_out=window[1], rooms=rooms, sort="price",
            ),
        )  # fmt: skip
    except Exception:  # noqa: BLE001 - the stay is then left as it is
        log.warning("hotel search for %s failed", town, exc_info=True)
        return None

    def rating(card: dict) -> float | None:
        try:
            return float(card.get("stars"))
        except (TypeError, ValueError):
            return None

    # Only hotels of the region that was searched: a card whose hotel we hold elsewhere (an id that
    # means another city) is not for this trip.
    region_id = (found.get("region") or {}).get("region_id")
    if country and region_id is not None:
        region = await session.scalar(
            select(SupplierRegion).where(SupplierRegion.region_id == region_id)
        )
        if region is not None and region.country_name.upper() != country:
            return None  # a town of the same name in another country is not this trip
    cards = [c for c in found.get("hotels") or [] if c.get("option") and c.get("hotel_id")]
    rows = {
        h.tj_hotel_id: h
        for h in await session.scalars(
            select(SupplierHotel).where(
                SupplierHotel.tj_hotel_id.in_([c["hotel_id"] for c in cards]),
                SupplierHotel.region_id == region_id,
            )
        )
    }
    cards = [c for c in cards if c["hotel_id"] in rows]
    if not hostels:  # a hostel is no stay for a couple, a family or older travellers
        cards = [c for c in cards if not stay_choice.is_hostel(rows[c["hotel_id"]])]
    fitting = [c for c in cards if (r := rating(c)) is not None and stars[0] <= r <= stars[1]]
    pool = fitting or cards
    if not pool:
        return None
    if budget:
        pick = min(pool, key=lambda c: c["option"]["price"]["total"])
    else:
        pick = max(pool, key=lambda c: c.get("rank") or 0)
    return rows[pick["hotel_id"]]


def _alternative(
    hotel: SupplierHotel, reason: str, got: dict, rooms: list[Room]
) -> StayAlternative:
    o = got["option"]
    return StayAlternative(
        hotel=StayHotel(id=hotel.tj_hotel_id, name=hotel.name),
        stars=hotel.star_rating,
        image_url=hotel.hero_image,
        reason=reason,
        total=o["price"]["total"],
        meal_basis=o["meal_basis"],
        room=(o["rooms"][0]["name"] if o["rooms"] else ""),
        free_cancellation_until=o["cancellation"]["free_until"],
        checked_at=got["checked_at"],
        rooms=describe(rooms),
    )


async def _suggestions(
    session: AsyncSession,
    mine: TravellerTrip,
    stay: dict,
    window: tuple[dt.date, dt.date],
    plans: list[list[Room]],
    own: SupplierHotel | None,
    country: str | None,
    gate: asyncio.Semaphore,
) -> list[StayAlternative]:
    """Hotels with a room for these nights, to offer next to a stay that has none: never put in
    its place. A stay the reel named looks first for hotels by that name; then the hotels of the
    stay's town that fit how the trip should feel. The first is the one the trip's rule picks: the
    cheapest for a budget trip, the best presented for a luxury one, else the middle rate."""
    candidates: list[tuple[SupplierHotel, str]] = []
    if stay.get("origin") == "reel":
        near = await nearest_hotels(
            session, matching.clean_name(stay["name"]), mine.destination_name, limit=ALTERNATIVES
        )
        ids = [a.hotel.id for a in near if a.reason.startswith("Close")]
        if ids:
            rows = await session.scalars(select(SupplierHotel).where(SupplierHotel.id.in_(ids)))
            close = {h.id: h for h in rows}
            candidates += [(close[i], "Close to the name in the reel") for i in ids if i in close]
    words = (mine.summary, mine.plan_summary, " ".join(mine.tips or []))
    said = " ".join(words)
    stars = stay_choice.stars_wanted(*words)
    hostels = builder.persona(mine.group, mine.adults, mine.kids, mine.seniors) == "solo"
    town = stay_town(stay, mine.destination_name)
    # The stay's own town first; the trip's destination when TripJack knows no town of that name.
    places = [town, *([mine.destination_name] if town != mine.destination_name else [])]
    for place in places:
        fitting = await stay_choice.fitting_hotels(session, place, stars, limit=8, hostels=hostels)
        if fitting:
            candidates += [(h, f"Has a room for your dates in {place}") for h in fitting]
            break
    seen: set = {own.id} if own is not None else set()
    unique = []
    for hotel, why in candidates:
        if hotel.id not in seen:
            seen.add(hotel.id)
            unique.append((hotel, why))

    async def price(hotel: SupplierHotel):
        async with gate:
            try:
                return await _priced(hotel.tj_hotel_id, window, plans)
            except (TripJackError, TripJackNotConfigured):
                return None, None

    answers = await asyncio.gather(*(price(h) for h, _ in unique))
    open_ = [
        (h, why, got, rooms)
        for (h, why), (got, rooms) in zip(unique, answers, strict=True)
        if got
    ]
    if not open_:  # none held for this destination yet: what TripJack can sell there
        for place in places:
            hotel = await _from_search(
                session, mine, place, window, plans[0], stars,
                bool(stay_choice.BUDGET.search(said)), hostels, country,
            )  # fmt: skip
            if hotel is not None and hotel.id not in seen:
                got, rooms = await price(hotel)
                if got:
                    open_ = [(hotel, f"Has a room for your dates in {place}", got, rooms)]
                    break
    if not open_:
        return []
    by_price = sorted(open_, key=lambda x: x[2]["option"]["price"]["total"])
    if stay_choice.BUDGET.search(said):
        first = by_price[0]
    elif stay_choice.LUXURY.search(said):
        first = open_[0]  # the best presented of the class
    else:
        first = by_price[(len(by_price) - 1) // 2]  # the middle rate, never the dearest of two
    ordered = [first, *(x for x in by_price if x is not first)]
    return [_alternative(h, why, got, rooms) for h, why, got, rooms in ordered[:ALTERNATIVES]]


async def stay_prices(session: AsyncSession, mine: TravellerTrip) -> StayPrices:
    """One row per stay: priced, unavailable (TripJack has no room), not_matched, no_dates,
    no_rooms or error. `total` adds up the priced stays only.

    Read-only: a price check never changes the trip. A stay whose hotel has no room, or that is no
    hotel we hold, keeps its name and gets priced suggestions next to it; changing it is the
    traveller's (or creator's) own edit."""
    party = mine.adults + mine.seniors
    plans = room_plans(party, mine.kids) if party else []
    items = list(mine.items or [])
    wanted = photos.stays(items)
    found = await photos.resolve(
        session, mine.source_trip_id, items, mine.destination_name, persist=False
    )
    country = await photos.destination_country(
        session, mine.destination_name, [i["name"] for i in items if i.get("kind") != "stay"]
    )
    start = mine.start_date
    nights = stay_nights(wanted, start, mine.days) if start else {}
    gate = asyncio.Semaphore(PARALLEL)
    configured = tripjack_hotels.configured

    async def one(stay: dict) -> dict:
        item_id = str(stay["id"])[:40]
        row: dict = {"item_id": item_id, "name": stay["name"], "status": "not_matched"}
        match = found.get(item_id)
        own = match.hotel if match is not None and match.state in photos.SHOWN else None
        if own is not None:
            row["hotel"] = {"id": own.tj_hotel_id, "name": own.name}
        window = nights.get(item_id)
        if start is None or window is None or window[1] <= window[0] or window[0] < dt.date.today():
            return {**row, "status": "no_dates"} if own is not None else row
        row.update(check_in=window[0].isoformat(), check_out=window[1].isoformat(),
                   nights=(window[1] - window[0]).days)  # fmt: skip
        if not plans:
            return {**row, "status": "no_rooms"}
        if not configured:
            return {**row, "status": "error"}
        if own is not None:
            try:
                async with gate:
                    got, rooms = await _priced(own.tj_hotel_id, window, plans)
            except (TripJackError, TripJackNotConfigured):
                log.warning("stay price failed for %s", own.tj_hotel_id, exc_info=True)
                return {**row, "status": "error"}
            if got is not None and rooms is not None:
                option = got["option"]
                return {
                    **row,
                    "status": "priced",
                    "total": option["price"]["total"],
                    "meal_basis": option["meal_basis"],
                    "room": (option["rooms"][0]["name"] if option["rooms"] else ""),
                    "free_cancellation_until": option["cancellation"]["free_until"],
                    "checked_at": got["checked_at"],
                    "rooms": describe(rooms),
                }
            row["status"] = "unavailable"
        offered = await _suggestions(session, mine, stay, window, plans, own, country, gate)
        return {**row, "alternatives": [a.model_dump(mode="json") for a in offered]}

    # One stay at a time: they share the database session. Each stay's prices go out in parallel.
    rows = [StayPrice(**await one(s)).model_dump(mode="json") for s in wanted]
    priced = [r for r in rows if r["status"] == "priced"]
    return StayPrices(**{
        "currency": settings.tripjack_currency,
        "stays": rows,
        "total": round(sum(r["total"] for r in priced), 2),
        "checked_at": min((r["checked_at"] for r in priced), default=None),
        "rooms": len(plans[0]) if plans else 0,
        "children_assumed_age": ASSUMED_CHILD_AGE if mine.kids else None,
        "all_priced": bool(rows) and len(priced) == len(rows),
    })
