"""Name the stay of a built trip. The AI writes "Stay in Downtown Dubai" when the reel names no
hotel; where we hold TripJack hotels for the destination, the stay becomes one of them, chosen by
how the trip is meant to feel (a budget reel gets a modest hotel, a luxury one a top one). The
hotel then carries its photo and live price like any other stay."""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hotels import matching, photos
from app.modules.hotels.models import SupplierHotel

BUDGET = re.compile(
    r"\b(budget|cheap|low[- ]cost|affordable|backpack|hostel|under\s*(?:rs|₹)?\s*\d)", re.I
)
LUXURY = re.compile(r"\b(luxury|luxurious|5[- ]star|five[- ]star|premium|splurge)\b", re.I)


def stars_wanted(*texts: str) -> tuple[float, float]:
    """The star range that fits what the reel says about money (3 to 4 when it says nothing)."""
    said = " ".join(t for t in texts if t)
    if BUDGET.search(said):
        return 2.0, 3.5
    if LUXURY.search(said):
        return 4.5, 5.0
    return 3.0, 4.5


async def pick_hotel(
    session: AsyncSession, destination: str, stars: tuple[float, float]
) -> SupplierHotel | None:
    """The best-presented hotel of the destination within the star range, else the best of any."""
    regions = await photos._regions_for(session, destination, [])
    if not regions:
        return None
    base = select(SupplierHotel).where(
        SupplierHotel.region_id.in_([r.region_id for r in regions]),
        SupplierHotel.is_active.is_(True),
        SupplierHotel.hero_image.is_not(None),
    )
    low, high = stars
    ranked = base.order_by(SupplierHotel.rank.desc()).limit(1)
    fitting = await session.scalar(
        base.where(SupplierHotel.star_rating.between(low, high))
        .order_by(SupplierHotel.rank.desc())
        .limit(1)
    )
    return fitting or await session.scalar(ranked)


def stay_town(item: dict) -> str | None:
    """The town a stay is in: kept on it ("town"), else the one in "Stay in <town>"."""
    if item.get("town"):
        return str(item["town"])
    found = re.match(r"stay in\s+(.+)$", str(item.get("name") or ""), re.I)
    return found.group(1).strip() if found else None


async def name_the_stay(
    session: AsyncSession, items: list[dict], destination: str, *money_words: str
) -> list[dict]:
    """A stay that is not a hotel we hold becomes one we do. Stays the traveller's reel named, and
    stays that already match a hotel, are left alone.
    A trip through several towns gets a hotel in each stay's own town, or none: never one hotel
    of the destination for every town. A trip with one base may use any hotel of the destination
    ("Stay in Seminyak" on a Bali trip)."""
    out = list(items)
    ours = [i for i in out if i.get("kind") == "stay" and i.get("origin") != "reel"]
    several = len({t.lower() for i in ours if (t := stay_town(i))}) > 1
    stars = stars_wanted(*money_words)
    for item in ours:
        if not destination:
            break
        hotel, score = await photos.best(session, item["name"], destination)
        if hotel is not None and score >= matching.REVIEW:
            continue
        town = stay_town(item)
        picked = await pick_hotel(session, town, stars) if town else None
        if picked is not None and town:
            item["town"] = town  # priced and shown in the town it is in
        elif not several:
            picked = await pick_hotel(session, destination, stars)
        if picked is None:
            continue
        item["name"] = picked.name[:200]
        item["note"] = "Check in. A hotel we picked for this trip; you can swap it."
        item["origin"] = "suggested"
    return out


def is_hostel(hotel: SupplierHotel) -> bool:
    return "hostel" in f"{hotel.name} {hotel.property_type}".lower()


async def fitting_hotels(
    session: AsyncSession,
    destination: str,
    stars: tuple[float, float],
    limit: int = 5,
    hostels: bool = False,
) -> list[SupplierHotel]:
    """The best-presented hotels of the destination within the star range, best first (the
    best-presented of any rating when none has a rating in the range)."""
    regions = await photos._regions_for(session, destination, [])
    if not regions:
        return []
    low, high = stars
    base = select(SupplierHotel).where(
        SupplierHotel.region_id.in_([r.region_id for r in regions]),
        SupplierHotel.is_active.is_(True),
        SupplierHotel.hero_image.is_not(None),
    )
    if not hostels:
        base = base.where(
            ~SupplierHotel.name.ilike("%hostel%"), ~SupplierHotel.property_type.ilike("%hostel%")
        )
    rows = list(
        await session.scalars(
            base.where(SupplierHotel.star_rating.between(low, high))
            .order_by(SupplierHotel.rank.desc())
            .limit(limit)
        )
    )
    if rows:
        return rows
    return list(await session.scalars(base.order_by(SupplierHotel.rank.desc()).limit(limit)))


async def same_country(session: AsyncSession, destination: str, origin_city: str) -> bool | None:
    """Is the trip inside one country (no visa, no passport)? Read from TripJack's cities: None
    when either place is not one we know."""
    from sqlalchemy import func

    from app.modules.hotels.models import SupplierRegion

    async def countries(name: str) -> set[str]:
        rows = await session.scalars(
            select(SupplierRegion.country_name).where(
                func.upper(SupplierRegion.city_name) == name.strip().upper()
            )
        )
        return set(rows)

    if not destination.strip() or not origin_city.strip():
        return None
    there, here = await countries(destination), await countries(origin_city)
    if not there or not here:
        return None
    return bool(there & here)
