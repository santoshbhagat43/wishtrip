"""Live TripJack prices for the stays of a traveller's trip, for its dates and party.

Only a stay that matches a TripJack hotel is priced, and only from TripJack's answer: a stay with
no match, no dates or no room says so, and is never given a number of ours."""

import asyncio
import datetime as dt
import logging
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.creators.models import TravellerTrip
from app.modules.hotels import photos
from app.modules.hotels.client import (
    TripJackError,
    TripJackNotConfigured,
    new_correlation_id,
    tripjack_hotels,
)
from app.modules.hotels.pricing import IST, normalise_options
from app.modules.hotels.schemas import Room
from app.modules.tripjack.cache import cache_get, cache_key, cache_set

log = logging.getLogger(__name__)

# How long a stay's price is kept before TripJack is asked again.
FRESH_SECONDS = 600
# Age TripJack is told for a child: the trip does not know it, so it is said on the page.
ASSUMED_CHILD_AGE = 8
PARALLEL = 4


class StayHotel(BaseModel):
    id: str
    name: str


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


async def stay_prices(session: AsyncSession, mine: TravellerTrip) -> StayPrices:
    """One row per stay: priced, unavailable (TripJack has no room), not_matched, no_dates or
    error. `total` adds up the priced stays only."""
    items = list(mine.items or [])
    wanted = photos.stays(items)
    found = await photos.resolve(session, mine.source_trip_id, items, mine.destination_name,
                                 persist=False)
    start = mine.start_date
    nights = stay_nights(wanted, start, mine.days) if start else {}
    party = mine.adults + mine.seniors
    rooms = rooms_for(party, mine.kids) if party else []
    gate = asyncio.Semaphore(PARALLEL)
    configured = tripjack_hotels.configured

    async def one(stay: dict) -> dict:
        item_id = str(stay["id"])[:40]
        row: dict = {"item_id": item_id, "name": stay["name"], "status": "not_matched"}
        match = found.get(item_id)
        if match is None or match.hotel is None or match.state not in photos.SHOWN:
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
