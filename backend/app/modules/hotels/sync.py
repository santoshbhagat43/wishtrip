"""Static catalogue sync: regions, hotel ids per region, hotel content.

Content is pulled once per region (then daily for changes) so a search never waits on it."""

import json
import logging
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hotels.client import TripJackHotels, tripjack_hotels
from app.modules.hotels.models import SupplierHotel, SupplierRegion
from app.modules.knowledge.models import Location, LocationType

log = logging.getLogger(__name__)

IMAGES_KEPT = 8


def _now() -> datetime:
    return datetime.now(UTC)


async def sync_regions(session: AsyncSession, client: TripJackHotels = tripjack_hotels) -> int:
    """Every TripJack city region (a few hundred thousand rows, ~2000 per call)."""
    cursor: str | None = None
    total = 0
    while True:
        page = await client.city_regions(cursor=cursor)
        rows = [
            {
                "region_id": int(r["cityRegionId"]),
                "city_name": (r.get("cityName") or "")[:255],
                "country_name": (r.get("countryName") or "")[:100],
                "full_name": (r.get("fullRegionName") or "")[:500],
            }
            for r in page.get("hotelCityRegionIds", [])
        ]
        if rows:
            stmt = insert(SupplierRegion).values(rows)
            await session.execute(
                stmt.on_conflict_do_update(
                    index_elements=["region_id"],
                    set_={
                        "city_name": stmt.excluded.city_name,
                        "country_name": stmt.excluded.country_name,
                        "full_name": stmt.excluded.full_name,
                    },
                )
            )
            await session.commit()
            total += len(rows)
        cursor = page.get("nextCursor")
        if not page.get("hasMore") or not cursor:
            return total


async def link_regions_to_locations(session: AsyncSession) -> int:
    """Match regions to our knowledge-base cities by name, and by country when the city has one.

    Names alone are not enough: there is a "Goa" in India and another in the Philippines, and
    "London" in Canada as well as England. A city we know the country of only links to regions in
    that country (a country spelled differently by TripJack is left unlinked, not mislinked)."""
    cities = (
        (await session.execute(select(Location).where(Location.type == LocationType.CITY)))
        .scalars()
        .all()
    )
    countries = {
        c.id: c.name.lower()
        for c in (
            await session.execute(select(Location).where(Location.type == LocationType.COUNTRY))
        ).scalars()
    }
    linked = 0
    for city in cities:
        names = {city.name.lower(), *(a.lower() for a in (city.aliases or []))}
        where = [
            func.lower(SupplierRegion.city_name).in_(names),
            SupplierRegion.location_id.is_(None),
        ]
        if country := countries.get(city.parent_id):
            where.append(func.lower(SupplierRegion.country_name) == country)
        result = await session.execute(
            update(SupplierRegion).where(*where).values(location_id=city.id)
        )
        linked += result.rowcount or 0
    await session.commit()
    return linked


async def sync_region_mapping(
    session: AsyncSession, region_id: int, client: TripJackHotels = tripjack_hotels
) -> int:
    """Pull every hotel id of a region (2000 per call). Cheap: no content yet."""
    page_no = 0
    total = 0
    while True:
        body = await client.hotel_mapping(region_ids=[str(region_id)], page=page_no)
        hotels = body.get("hotels", [])
        if hotels:
            stmt = insert(SupplierHotel).values(
                [
                    {
                        "tj_hotel_id": str(h["tjHotelId"]),
                        "unica_id": str(h.get("unicaId") or ""),
                        "region_id": region_id,
                    }
                    for h in hotels
                ]
            )
            await session.execute(
                stmt.on_conflict_do_update(
                    index_elements=["tj_hotel_id"],
                    set_={"unica_id": stmt.excluded.unica_id, "region_id": region_id},
                )
            )
            total += len(hotels)
        pageable = body.get("pageable") or {}
        page_no += 1
        if not hotels or page_no >= int(pageable.get("totalPages") or 0):
            break
    await session.execute(
        update(SupplierRegion)
        .where(SupplierRegion.region_id == region_id)
        .values(mapping_synced_at=_now(), hotel_count=total)
    )
    await session.commit()
    return total


def _description(raw: dict) -> str:
    """`descriptions.default` is a JSON string like {"Overview": "...", "Snippet": "..."}."""
    default = raw.get("default")
    if not default:
        return ""
    try:
        parsed = json.loads(default) if isinstance(default, str) else default
    except ValueError:
        return str(default)
    if isinstance(parsed, dict):
        return str(parsed.get("Overview") or parsed.get("Snippet") or "")
    return str(parsed)


def _policies(raw: dict) -> dict:
    know = raw.get("know_before_you_go")
    if not know:
        return {}
    try:
        parsed = json.loads(know) if isinstance(know, str) else know
    except ValueError:
        return {"Know before you go": str(know)}
    return parsed if isinstance(parsed, dict) else {}


def hotel_fields(h: dict) -> dict:
    """Flatten one `fetch-hotel-content` hotel into SupplierHotel columns."""
    locale = h.get("locale") or {}
    address = locale.get("address") or {}
    coords = locale.get("coordinates") or {}
    images = []
    hero: str | None = None
    for img in h.get("images") or []:
        links = img.get("links") or {}
        url = (links.get("XXL") or links.get("Standard") or {}).get("href")
        if not url:
            continue
        if img.get("is_hero_image") and hero is None:
            hero = url
            images.insert(0, {"caption": img.get("caption") or "", "url": url})
        else:
            images.append({"caption": img.get("caption") or "", "url": url})
    images = images[:IMAGES_KEPT]
    hero = hero or (images[0]["url"] if images else None)
    amenities = [a.get("name") for a in (h.get("amenities") or {}).values() if a.get("name")]
    try:
        stars = float(h.get("star_rating")) if h.get("star_rating") else None
    except (TypeError, ValueError):
        stars = None
    descriptions = h.get("descriptions") or {}
    description = _description(descriptions)
    headline = descriptions.get("headline") or ""
    # Rank: stars first, then how well the hotel is presented.
    rank = (
        (stars or 0) * 10
        + min(len(images), 8)
        + (2 if description else 0)
        + min(len(amenities), 10) / 5
    )
    return {
        "name": (h.get("name") or "")[:500],
        "is_active": bool(h.get("is_active", True)),
        "star_rating": stars,
        "property_type": ((h.get("property_type") or {}).get("name") or "")[:100],
        "address": (address.get("fulladdr") or "")[:1000],
        "city": (address.get("city") or "")[:255],
        "country": (address.get("countryname") or "")[:100],
        "latitude": coords.get("lat"),
        "longitude": coords.get("long"),
        "hero_image": hero,
        "images": images,
        "amenities": amenities[:40],
        "headline": headline,
        "description": description,
        "policies": _policies(h.get("policies") or {}),
        "rank": rank,
        "content_synced_at": _now(),
    }


async def store_content(session: AsyncSession, hotels: list[dict]) -> int:
    n = 0
    for h in hotels:
        tj_id = str(h.get("tjHotelId") or "")
        if not tj_id:
            continue
        fields = hotel_fields(h)
        result = await session.execute(
            update(SupplierHotel).where(SupplierHotel.tj_hotel_id == tj_id).values(**fields)
        )
        n += result.rowcount or 0
    await session.commit()
    return n


async def sync_region_content(
    session: AsyncSession, region_id: int, client: TripJackHotels = tripjack_hotels,
    limit: int | None = None,
) -> int:
    """Fetch content (100 hotels a call) for the region's hotels that have none yet."""
    query = (
        select(SupplierHotel.tj_hotel_id)
        .where(SupplierHotel.region_id == region_id, SupplierHotel.content_synced_at.is_(None))
        .order_by(SupplierHotel.tj_hotel_id)
    )
    if limit:
        query = query.limit(limit)
    ids = list((await session.execute(query)).scalars())
    done = 0
    for i in range(0, len(ids), 100):
        done += await store_content(session, await client.hotel_content(ids[i : i + 100]))
    if limit is None:
        await session.execute(
            update(SupplierRegion)
            .where(SupplierRegion.region_id == region_id)
            .values(content_synced_at=_now())
        )
        await session.commit()
    return done
