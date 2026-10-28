"""Live TripJack prices for the stays of a traveller's trip, for its dates and party.

Only a stay that matches a TripJack hotel is priced, and only from TripJack's answer: a stay with
no match, no dates or no room says so, and is never given a number of ours."""

import asyncio
import datetime as dt
import logging
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
from app.modules.hotels.models import SupplierHotel
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


class StayPrice(BaseModel):
    item_id: str
    name: str
    # priced · unavailable (no room for these dates) · not_matched · no_dates · error
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
    # When the stay named no hotel we hold: the closest hotels that have a room, priced.
    alternatives: list[StayAlternative] = []


class StayPrices(BaseModel):
    currency: str
    stays: list[StayPrice]
    total: float
    checked_at: str | None = None
    rooms: int
    children_assumed_age: int | None = None
    all_priced: bool


def rooms_for(adults: int, kids: int) -> list[Room]:
    """Two grown-ups to a room; the children share the first room."""
    adults = max(1, adults)
    rooms = [Room(adults=min(2, adults - i)) for i in range(0, adults, 2)]
    rooms[0] = Room(adults=rooms[0].adults, child_ages=[ASSUMED_CHILD_AGE] * min(kids, 4))
    return rooms


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


def _cheapest(options: list[dict]) -> dict | None:
    return options[0] if options else None  # normalise_options sorts cheapest first


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


async def _room_total(
    hotel: SupplierHotel, window: tuple[dt.date, dt.date], rooms: list[Room]
) -> float | None:
    """The cheapest rate TripJack has for these nights, or None when there is no room."""
    try:
        got = await _price(hotel.tj_hotel_id, *window, rooms)
    except (TripJackError, TripJackNotConfigured):
        return None
    option = got.get("option")
    return option["price"]["total"] if option else None


async def _has_a_room(
    hotel: SupplierHotel, window: tuple[dt.date, dt.date], rooms: list[Room]
) -> bool:
    return await _room_total(hotel, window, rooms) is not None


async def _from_search(
    session: AsyncSession,
    mine: TravellerTrip,
    window: tuple[dt.date, dt.date],
    rooms: list[Room],
    stars: tuple[float, float],
    budget: bool,
) -> SupplierHotel | None:
    """When we hold no hotels for the destination yet, ask TripJack what it can sell for these
    nights: the cheapest of the right class for a budget trip, else the best presented."""
    try:
        found = await hotel_search.search(
            session,
            HotelSearch(
                city=mine.destination_name, check_in=window[0], check_out=window[1], rooms=rooms,
                sort="price",
            ),
        )  # fmt: skip
    except Exception:  # noqa: BLE001 - the stay is then left as it is
        log.warning("hotel search for %s failed", mine.destination_name, exc_info=True)
        return None

    def rating(card: dict) -> float | None:
        try:
            return float(card.get("stars"))
        except (TypeError, ValueError):
            return None

    # Only hotels of the region that was searched: a card whose hotel we hold elsewhere (an id that
    # means another city) is not for this trip.
    region_id = (found.get("region") or {}).get("region_id")
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
    fitting = [c for c in cards if (r := rating(c)) is not None and stars[0] <= r <= stars[1]]
    pool = fitting or cards
    if not pool:
        return None
    if budget:
        pick = min(pool, key=lambda c: c["option"]["price"]["total"])
    else:
        pick = max(pool, key=lambda c: c.get("rank") or 0)
    return rows[pick["hotel_id"]]


async def settle_stays(session: AsyncSession, mine: TravellerTrip, rooms: list[Room]) -> bool:
    """Make every stay a hotel TripJack can sell for these nights, so the trip's price is whole.

    A stay that is no hotel we hold (or only a likely match), and one whose hotel has no room for
    the dates, is swapped for the closest hotel that does have a room: first by name, then by what
    fits the reel's budget. The reel's own words are kept in the note. Stays staff unlinked are
    left alone, and nothing changes when TripJack cannot be asked. True when the trip changed."""
    start = mine.start_date
    if not (start and rooms and tripjack_hotels.configured):
        return False
    items = [dict(i) for i in mine.items or []]  # copies: the saved list must differ to be saved
    wanted = photos.stays(items)
    if not wanted:
        return False
    found = await photos.resolve(
        session, mine.source_trip_id, items, mine.destination_name, persist=False
    )
    nights = stay_nights(wanted, start, mine.days)
    gate = asyncio.Semaphore(PARALLEL)
    changed = False
    for stay in wanted:
        item_id = str(stay["id"])[:40]
        match = found.get(item_id)
        window = nights.get(item_id)
        if match is not None and match.state == "unlinked":
            continue
        if not window or window[1] <= window[0] or window[0] < dt.date.today():
            continue
        if match is not None and match.state in photos.SHOWN and match.hotel is not None:
            async with gate:
                if await _has_a_room(match.hotel, window, rooms):
                    continue  # a hotel we hold, with a room: priced as it is
        candidates: list[SupplierHotel] = []
        # A stay the reel named is matched by its name. One we wrote ourselves ("Stay in Downtown
        # Dubai") names an area, not a hotel: matching its words would pick any hotel with
        # "Downtown" in its name, so it goes by what fits the trip.
        if stay.get("origin") == "reel":
            near = await nearest_hotels(
                session, matching.clean_name(stay["name"]), mine.destination_name,
                limit=ALTERNATIVES,
            )  # fmt: skip
            ids = [a.hotel.id for a in near if a.reason.startswith("Close")]
            if ids:
                close = await session.scalars(
                    select(SupplierHotel).where(SupplierHotel.id.in_(ids))
                )
                by_id = {h.id: h for h in close}
                candidates += [by_id[i] for i in ids if i in by_id]
        words = (mine.summary, mine.plan_summary, " ".join(mine.tips or []))
        stars = stay_choice.stars_wanted(*words)
        for h in await stay_choice.fitting_hotels(session, mine.destination_name, stars, limit=8):
            if all(h.id != c.id for c in candidates):
                candidates.append(h)
        if match is not None and match.state in photos.SHOWN and match.hotel is not None:
            candidates = [c for c in candidates if c.id != match.hotel.id]  # it has no room

        async def total(h: SupplierHotel, nights_: tuple[dt.date, dt.date]) -> float | None:
            async with gate:
                return await _room_total(h, nights_, rooms)

        totals = await asyncio.gather(*(total(h, window) for h in candidates))
        open_ = [(h, t) for h, t in zip(candidates, totals, strict=True) if t is not None]
        # The first with a room, in order of fit; but a budget trip takes the cheapest of them
        # and a luxury one the best presented, so the price is the one the trip is about.
        chosen = None
        if open_:
            if stay_choice.BUDGET.search(" ".join(words)):
                chosen = min(open_, key=lambda pair: pair[1])[0]
            else:
                chosen = open_[0][0]
        if chosen is None:  # none held for this destination yet: what TripJack can sell
            cheap = bool(stay_choice.BUDGET.search(" ".join(words)))
            chosen = await _from_search(session, mine, window, rooms, stars, cheap)
        if chosen is None:
            continue
        for item in items:
            if str(item.get("id"))[:40] == item_id:
                item["was"] = item.get("was") or item["name"]
                item["name"] = chosen.name[:200]
                item["note"] = (
                    f"Swapped from “{item['was']}” for a hotel with a room for your dates "
                    "and a live price."
                )[:500]
                item["origin"] = "suggested"
                item["verified"] = False
        changed = True
    if changed:
        mine.items = items
        await session.commit()
    return changed


async def stay_prices(session: AsyncSession, mine: TravellerTrip) -> StayPrices:
    """One row per stay: priced, unavailable (TripJack has no room), not_matched, no_dates or
    error. `total` adds up the priced stays only."""
    party = mine.adults + mine.seniors
    rooms = rooms_for(party, mine.kids) if party else []
    await settle_stays(session, mine, rooms)  # first: every stay a hotel with a room
    items = list(mine.items or [])
    wanted = photos.stays(items)
    found = await photos.resolve(session, mine.source_trip_id, items, mine.destination_name,
                                 persist=False)
    start = mine.start_date
    nights = stay_nights(wanted, start, mine.days) if start else {}
    gate = asyncio.Semaphore(PARALLEL)
    configured = tripjack_hotels.configured

    # The closest hotels for each stay that names none we hold (read here: the session is not
    # shared between the parallel price calls below).
    near: dict[str, list[tuple[SupplierHotel, str]]] = {}
    for stay in wanted:
        item_id = str(stay["id"])[:40]
        match = found.get(item_id)
        if start and rooms and configured and (match is None or match.state in ("review", "nomatch")):
            options = await nearest_hotels(
                session, matching.clean_name(stay["name"]), mine.destination_name, limit=ALTERNATIVES
            )
            ids = [a.hotel.id for a in options]
            hotels = {h.id: h for h in await session.scalars(
                select(SupplierHotel).where(SupplierHotel.id.in_(ids)))} if ids else {}
            near[item_id] = [(hotels[a.hotel.id], a.reason) for a in options if a.hotel.id in hotels]

    async def alternative(hotel: SupplierHotel, reason: str, window: tuple[dt.date, dt.date]):
        try:
            async with gate:
                got = await _price(hotel.tj_hotel_id, *window, rooms)
        except (TripJackError, TripJackNotConfigured):
            return None
        o = got.get("option")
        if o is None:
            return None
        return StayAlternative(
            hotel=StayHotel(id=hotel.tj_hotel_id, name=hotel.name), stars=hotel.star_rating,
            image_url=hotel.hero_image, reason=reason, total=o["price"]["total"],
            meal_basis=o["meal_basis"], room=(o["rooms"][0]["name"] if o["rooms"] else ""),
            free_cancellation_until=o["cancellation"]["free_until"], checked_at=got["checked_at"],
        )

    async def one(stay: dict) -> dict:
        item_id = str(stay["id"])[:40]
        row: dict = {"item_id": item_id, "name": stay["name"], "status": "not_matched"}
        match = found.get(item_id)
        if match is None or match.hotel is None or match.state not in photos.SHOWN:
            window = nights.get(item_id)
            if item_id in near and window and window[1] > window[0] >= dt.date.today():
                priced = await asyncio.gather(*(alternative(h, why, window) for h, why in near[item_id]))
                row["alternatives"] = [a.model_dump(mode="json") for a in priced if a]
                row.update(check_in=window[0].isoformat(), check_out=window[1].isoformat(),
                           nights=(window[1] - window[0]).days)
            return row
        row["hotel"] = {"id": match.hotel.tj_hotel_id, "name": match.hotel.name}
        if start is None or item_id not in nights or not rooms:
            return {**row, "status": "no_dates"}
        check_in, check_out = nights[item_id]
        if check_out <= check_in or check_in < dt.date.today():
            return {**row, "status": "no_dates"}
        row.update(check_in=check_in.isoformat(), check_out=check_out.isoformat(),
                   nights=(check_out - check_in).days)
        if not configured:
            return {**row, "status": "error"}
        try:
            async with gate:
                got = await _price(match.hotel.tj_hotel_id, check_in, check_out, rooms)
        except (TripJackError, TripJackNotConfigured):
            log.warning("stay price failed for %s", match.hotel.tj_hotel_id, exc_info=True)
            return {**row, "status": "error"}
        option = got.get("option")
        if option is None:
            return {**row, "status": "unavailable"}
        return {
            **row,
            "status": "priced",
            "total": option["price"]["total"],
            "meal_basis": option["meal_basis"],
            "room": (option["rooms"][0]["name"] if option["rooms"] else ""),
            "free_cancellation_until": option["cancellation"]["free_until"],
            "checked_at": got["checked_at"],
        }

    rows = [StayPrice(**r).model_dump(mode="json")
            for r in await asyncio.gather(*(one(s) for s in wanted))]
    priced = [r for r in rows if r["status"] == "priced"]
    return StayPrices(**{
        "currency": settings.tripjack_currency,
        "stays": rows,
        "total": round(sum(r["total"] for r in priced), 2),
        "checked_at": min((r["checked_at"] for r in priced), default=None),
        "rooms": len(rooms),
        "children_assumed_age": ASSUMED_CHILD_AGE if mine.kids else None,
        "all_priced": bool(rows) and len(priced) == len(rows),
    })
