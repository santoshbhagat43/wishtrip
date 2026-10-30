"""Photos for the hotels a creator's itinerary stays at, from TripJack's own hotel content.

Each stay is matched to a TripJack hotel by name (hotels/matching.py); the match is saved
(`StayMatch`) so it is stable, can be reviewed, and can be corrected by staff. A photo shows only
for a confident or staff-confirmed match; otherwise the stay keeps its icon. Nothing is guessed.
The hotels of the trip's destination are fetched from TripJack in the background the first time
they are needed (their names come with the content, not the id list)."""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hotels import matching
from app.modules.hotels.models import StayMatch, SupplierHotel, SupplierRegion

log = logging.getLogger(__name__)

# Most hotels fetched for one trip's destination (100 per TripJack call).
FETCH_LIMIT = 8000
# States whose hotel photo is shown to travellers.
SHOWN = ("matched", "confirmed")


@dataclass
class Resolved:
    state: str
    score: float
    hotel: SupplierHotel | None
    row: StayMatch | None = None


async def candidates(
    session: AsyncSession,
    text: str,
    *,
    limit: int = 60,
    with_photo: bool = True,
    country: str | None = None,
) -> list[SupplierHotel]:
    """Hotels whose names look like `text`, closest first (typos and extra words allowed). With a
    `country`, only hotels in that country: a name alone never moves a trip to another country."""
    query = " ".join(matching.words(matching.clean_name(text)))
    if not query:
        return []
    name = func.lower(SupplierHotel.name)
    closeness = func.greatest(func.similarity(name, query), func.word_similarity(query, name))
    stmt = select(SupplierHotel).where(
        SupplierHotel.is_active.is_(True),
        or_(name.op("%")(query), literal(query).op("<%")(name)),
    )
    if with_photo:
        stmt = stmt.where(SupplierHotel.hero_image.is_not(None))
    if country:
        stmt = stmt.join(SupplierRegion, SupplierRegion.region_id == SupplierHotel.region_id).where(
            func.upper(SupplierRegion.country_name) == country.upper()
        )
    return list((await session.scalars(stmt.order_by(closeness.desc()).limit(limit))).all())


async def destination_country(
    session: AsyncSession, destination: str, places: list[str] | None = None
) -> str | None:
    """The country a trip is in, as TripJack names it ("INDONESIA"), or None when we cannot tell.

    The destination as a TripJack city (Bali is one in Indonesia and one in Rajasthan: the trip's
    other places, then the number of hotels, decide), else as a country ("Vietnam"), else as a
    state or region in a city's full name ("Maharashtra"). Kept on the session per destination."""
    key = (destination or "").strip().upper()
    if not key:
        return None
    memo: dict = session.info.setdefault("trip_country", {})
    if key in memo:
        return memo[key]
    country: str | None = None
    regions = await _regions_for(session, destination, list(places or []))
    if regions:
        country = regions[0].country_name.upper()
    else:
        named = await session.scalar(
            select(SupplierRegion.country_name)
            .where(func.upper(SupplierRegion.country_name) == key)
            .limit(1)
        )
        if named:
            country = named.upper()
        else:
            counts = (
                await session.execute(
                    select(SupplierRegion.country_name, func.count())
                    .where(func.upper(SupplierRegion.full_name).like(f"%, {key}, %"))
                    .group_by(SupplierRegion.country_name)
                    .order_by(func.count().desc())
                    .limit(1)
                )
            ).first()
            country = counts[0].upper() if counts else None
    memo[key] = country
    return country


def _area(hotel: SupplierHotel) -> str:
    return f"{hotel.city} {hotel.address} {hotel.country}"


async def ranked(
    session: AsyncSession, name: str, place: str = "", *, search: str | None = None, limit: int = 12
) -> list[tuple[SupplierHotel, float]]:
    """The likeliest hotels for a stay, best first, each with its score. `search` replaces the
    stay's name (staff typing the hotel they mean)."""
    text = search or name
    country = await destination_country(session, place) if place else None
    found = await candidates(session, text, country=country)
    scored = [(h, matching.score(text, h.name, place, _area(h))) for h in found]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:limit]


async def best(
    session: AsyncSession, name: str, place: str = ""
) -> tuple[SupplierHotel | None, float]:
    """The hotel this stay is, and how sure we are. Two different hotels that fit equally well
    make it a question for staff, so the score is capped below the confident line."""
    top = await ranked(session, name, place, limit=2)
    if not top or top[0][1] < matching.REVIEW:
        return None, top[0][1] if top else 0.0
    hotel, value = top[0]
    if len(top) > 1:
        other, other_value = top[1]
        different = matching.words(other.name) != matching.words(hotel.name)
        if different and other_value >= value - 0.03 and value >= matching.CONFIDENT:
            value = matching.CONFIDENT - 0.01
    return hotel, value


def stays(items: list[dict]) -> list[dict]:
    return [i for i in items if i.get("kind") == "stay" and (i.get("name") or "").strip()]


def _state(value: float, hotel: SupplierHotel | None) -> str:
    if hotel is None:
        return "nomatch"
    return "matched" if value >= matching.CONFIDENT else "review"


async def resolve(
    session: AsyncSession,
    trip_id: uuid.UUID | None,
    items: list[dict],
    place: str = "",
    *,
    persist: bool = True,
) -> dict[str, Resolved]:
    """The match of every stay in a trip's items: the saved one when there is one, else worked
    out now (and saved, when `persist`). Staff decisions are never overridden."""
    wanted = stays(items)
    if not wanted:
        return {}
    saved: dict[str, StayMatch] = {}
    if trip_id is not None:
        rows = await session.scalars(select(StayMatch).where(StayMatch.trip_id == trip_id))
        saved = {r.item_id: r for r in rows}
    ids = {r.hotel_id for r in saved.values() if r.hotel_id}
    known = {}
    if ids:
        hotels = await session.scalars(select(SupplierHotel).where(SupplierHotel.id.in_(ids)))
        known = {h.id: h for h in hotels}

    out: dict[str, Resolved] = {}
    changed = False
    for item in wanted:
        item_id = str(item["id"])[:40]
        cleaned = matching.clean_name(item["name"])
        row = saved.get(item_id)
        if row is not None and (
            row.state in ("confirmed", "unlinked")
            or (row.state == "matched" and row.stay_name == cleaned)
        ):
            out[item_id] = Resolved(row.state, row.score, known.get(row.hotel_id), row)
            continue
        # New, renamed, or still undecided (review / nomatch: tried again as hotels are fetched).
        hotel, value = await best(session, item["name"], place)
        state = _state(value, hotel)
        if persist and trip_id is not None:
            if row is None:
                row = StayMatch(trip_id=trip_id, item_id=item_id)
                session.add(row)
                changed = True
            hotel_id = hotel.id if hotel else None
            if (row.state, row.hotel_id, row.stay_name) != (state, hotel_id, cleaned):
                row.state, row.hotel_id, row.stay_name = state, hotel_id, cleaned
                row.score = value
                changed = True
        out[item_id] = Resolved(state, value, hotel, row)
    if changed:
        await session.commit()
    return out


async def attach(
    session: AsyncSession,
    items: list[dict],
    trip_id: uuid.UUID | None = None,
    place: str = "",
    *,
    persist: bool = True,
) -> tuple[list[dict], list[dict]]:
    """The items with `image_url` and `image_hotel` on every stay whose match is confident or
    confirmed, and the stays still without a photo (staff-unlinked ones excluded: those are
    decided)."""
    found = await resolve(session, trip_id, items, place, persist=persist)
    out, missing = [], []
    for item in items:
        match = found.get(str(item.get("id"))[:40]) if item.get("kind") == "stay" else None
        if match is None:
            out.append(item)
        elif match.state in SHOWN and match.hotel is not None and match.hotel.hero_image:
            hotel = match.hotel
            out.append({**item, "image_url": hotel.hero_image, "image_hotel": hotel.name})
        else:
            out.append(item)
            if match.state != "unlinked":
                missing.append(item)
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
    # A tie (no other place names to go by) goes to the country where the name is the bigger
    # place: Bali, Indonesia has thousands of hotels, Bali, Rajasthan a handful.
    hotels = {c: sum(r.hotel_count for r in found if r.country_name == c) for c in countries}
    country = max(countries, key=lambda c: (len(names_by_country[c]), hotels[c]))
    chosen = [r for r in found if r.country_name == country]
    chosen.sort(key=lambda r: (wanted.index(r.city_name.upper()), -r.hotel_count))
    return chosen[:4]


async def fetch_for_trip(
    session: AsyncSession, trip_id: uuid.UUID, items: list[dict], destination: str
) -> int:
    """Fetch hotel content from TripJack for the trip's destination until every stay has a
    matching photo, or the limit is reached. Returns how many hotels were fetched."""
    from app.modules.hotels.sync import sync_region_content, sync_region_mapping

    _, missing = await attach(session, items, trip_id, destination)
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
            _, missing = await attach(session, items, trip_id, destination)
            if not missing or n == 0:
                break
        if not missing or fetched >= FETCH_LIMIT:
            break
    return fetched
