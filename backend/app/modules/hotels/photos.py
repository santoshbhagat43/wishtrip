"""Photos for the hotels a creator's itinerary stays at, from TripJack's own hotel content.

A stay is only given a picture when its name closely matches a TripJack hotel; otherwise it keeps
its icon. Nothing is guessed. The hotels of the trip's destination are fetched from TripJack in the
background the first time they are needed (their names come with the content, not the id list)."""

import logging
import re

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hotels.models import SupplierHotel, SupplierRegion

log = logging.getLogger(__name__)

# Words that say "this is a hotel" rather than which one.
GENERIC = {
    "hotel", "resort", "resorts", "spa", "villa", "villas", "the", "and", "by", "at", "of", "in",
    "stay", "stays", "inn", "suites", "suite", "boutique", "homestay", "guest", "house", "lodge",
    "bali", "restaurant", "beach", "club",
}
# Most hotels fetched for one trip's destination (100 per TripJack call).
FETCH_LIMIT = 8000


def tokens(name: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", name.lower().replace("&", " and ")) if t]


def distinctive(name: str) -> set[str]:
    return {t for t in tokens(name) if t not in GENERIC}


def best_match(stop_name: str, hotels: list[SupplierHotel]) -> SupplierHotel | None:
    """The hotel whose name has every distinctive word of the stop's name (and not many more)."""
    want = distinctive(stop_name)
    if not want:
        return None
    best: tuple[float, SupplierHotel] | None = None
    for hotel in hotels:
        have = distinctive(hotel.name)
        if not have or not want <= have or len(have - want) > 2:
            continue
        if len(want) == 1 and have != want:
            continue  # one common word ("Mega") isn't enough to call it the same hotel
        score = len(want) / len(have | want)
        if best is None or score > best[0]:
            best = (score, hotel)
    return best[1] if best else None


async def _candidates(session: AsyncSession, name: str) -> list[SupplierHotel]:
    words = sorted(distinctive(name), key=len, reverse=True)[:3]
    if not words:
        return []
    return list(
        (
            await session.execute(
                select(SupplierHotel)
                .where(
                    SupplierHotel.hero_image.is_not(None),
                    SupplierHotel.is_active.is_(True),
                    and_(*[func.lower(SupplierHotel.name).contains(w) for w in words]),
                )
                .limit(80)
            )
        ).scalars()
    )


def stays(items: list[dict]) -> list[dict]:
    return [i for i in items if i.get("kind") == "stay" and (i.get("name") or "").strip()]


async def attach(session: AsyncSession, items: list[dict]) -> tuple[list[dict], list[dict]]:
    """The items with `image_url` and `image_hotel` on every stay that matches a TripJack hotel,
    and the stays that matched none."""
    out, missing = [], []
    for item in items:
        if item.get("kind") != "stay" or not (item.get("name") or "").strip():
            out.append(item)
            continue
        hotel = best_match(item["name"], await _candidates(session, item["name"]))
        if hotel is None:
            out.append(item)
            missing.append(item)
        else:
            out.append({**item, "image_url": hotel.hero_image, "image_hotel": hotel.name})
    return out, missing


async def _regions_for(
    session: AsyncSession, destination: str, places: list[str]
) -> list[SupplierRegion]:
    """TripJack's region for the destination, then those named like the trip's other places in the
    same country (Kuta and Ubud for a Bali trip)."""
    wanted = [destination.strip().upper(), *[p.strip().upper() for p in places]]
    wanted = [w for i, w in enumerate(wanted) if w and w not in wanted[:i]]
    if not wanted:
        return []
    found = list(
        (
            await session.execute(
                select(SupplierRegion).where(func.upper(SupplierRegion.city_name).in_(wanted))
            )
        ).scalars()
    )
    # City names repeat across the world (a Bali in Rajasthan, another in Crete). The country is the
    # one where most of the trip's own place names are TripJack regions too.
    names_by_country: dict[str, set[str]] = {}
    for r in found:
        names_by_country.setdefault(r.country_name, set()).add(r.city_name.upper())
    countries = [c for c, names in names_by_country.items() if wanted[0] in names]
    if not countries:
        return []
    country = max(countries, key=lambda c: len(names_by_country[c]))
    chosen = [r for r in found if r.country_name == country]
    chosen.sort(key=lambda r: (wanted.index(r.city_name.upper()), -r.hotel_count))
    return chosen[:4]


async def fetch_for_trip(session: AsyncSession, items: list[dict], destination: str) -> int:
    """Fetch hotel content from TripJack for the trip's destination until every stay has a
    matching photo, or the limit is reached. Returns how many hotels were fetched."""
    from app.modules.hotels.sync import sync_region_content, sync_region_mapping

    _, missing = await attach(session, items)
    if not missing:
        return 0
    places = [i["name"] for i in items if i.get("kind") != "stay"]
    fetched = 0
    for region in await _regions_for(session, destination, places):
        if region.mapping_synced_at is None:
            await sync_region_mapping(session, region.region_id)
        while fetched < FETCH_LIMIT:
            n = await sync_region_content(session, region.region_id, limit=100)
            fetched += n
            _, missing = await attach(session, items)
            if not missing or n == 0:
                break
        if not missing or fetched >= FETCH_LIMIT:
            break
    return fetched
