"""Hotel search: our catalogue picks the hotels, TripJack prices them live.

Speed comes from three things: the catalogue is local (no content call per search), Listing
runs in parallel chunks of 100 hotels, and repeat searches are served from Redis."""

import asyncio
import logging
from collections.abc import AsyncIterator

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.hotels.client import TripJackError, new_correlation_id, tripjack_hotels
from app.modules.hotels.models import SupplierHotel, SupplierRegion
from app.modules.hotels.pricing import normalise_options
from app.modules.hotels.schemas import HotelPricing, HotelSearch
from app.modules.hotels.sync import sync_region_content, sync_region_mapping
from app.modules.tripjack import trace
from app.modules.tripjack.cache import cache_get as _cache_get
from app.modules.tripjack.cache import cache_key as _key
from app.modules.tripjack.cache import cache_set as _cache_set

log = logging.getLogger(__name__)

CHUNK = 100


class NoDestination(Exception):
    pass


async def resolve_region(session: AsyncSession, q: HotelSearch) -> SupplierRegion:
    if q.region_id:
        region = (
            await session.execute(
                select(SupplierRegion).where(SupplierRegion.region_id == q.region_id)
            )
        ).scalar_one_or_none()
    elif q.location_id:
        region = (
            await session.execute(
                select(SupplierRegion)
                .where(SupplierRegion.location_id == q.location_id)
                .order_by(SupplierRegion.hotel_count.desc())
            )
        ).scalars().first()
    elif q.city:
        region = (
            await session.execute(
                select(SupplierRegion)
                .where(func.lower(SupplierRegion.city_name) == q.city.strip().lower())
                .order_by(SupplierRegion.hotel_count.desc(), SupplierRegion.region_id)
            )
        ).scalars().first()
    else:
        raise NoDestination("Give a region_id, location_id or city")
    if region is None and q.city and not (q.region_id or q.location_id):
        # A spelling that differs a little from TripJack's ("Phuentsholing" for PHUNTSHOLING).
        wanted = q.city.strip().lower()
        close = func.similarity(func.lower(SupplierRegion.city_name), wanted)
        region = (
            await session.execute(
                select(SupplierRegion)
                .where(close >= 0.6)
                .order_by(close.desc(), SupplierRegion.hotel_count.desc())
            )
        ).scalars().first()
    if region is None:
        raise NoDestination("No hotel region matches that destination")
    return region


async def _ensure_catalogue(session: AsyncSession, region: SupplierRegion) -> None:
    """First search in a city: pull its hotel ids and the content of the first batch inline
    (a few seconds, once). The rest of the content is filled in by a background job."""
    if region.mapping_synced_at is None:
        await sync_region_mapping(session, region.region_id)
        await session.refresh(region)
    have = (
        await session.execute(
            select(func.count())
            .select_from(SupplierHotel)
            .where(
                SupplierHotel.region_id == region.region_id,
                SupplierHotel.content_synced_at.is_not(None),
            )
        )
    ).scalar_one()
    if have < settings.tripjack_search_hotels and region.content_synced_at is None:
        await sync_region_content(
            session, region.region_id, limit=settings.tripjack_search_hotels - have
        )
        from app.workers.tasks import sync_region_content_task

        sync_region_content_task.delay(region.region_id)


async def _candidates(session: AsyncSession, region_id: int) -> list[SupplierHotel]:
    return list(
        (
            await session.execute(
                select(SupplierHotel)
                .where(
                    SupplierHotel.region_id == region_id,
                    SupplierHotel.is_active.is_(True),
                    SupplierHotel.content_synced_at.is_not(None),
                )
                .order_by(SupplierHotel.rank.desc())
                .limit(settings.tripjack_search_hotels)
            )
        ).scalars()
    )


def _listing_id(item: dict) -> str:
    """TripJack's documentation says `tjHotelId`, but Listing really answers `hotelId` (the content
    and mapping APIs do use `tjHotelId`). Accept both."""
    return str(item.get("hotelId") or item.get("tjHotelId") or "")


def _card(hotel: SupplierHotel, listing: dict) -> dict | None:
    """The cheapest bookable option of a Listing hotel, joined with our static data."""
    options = normalise_options(listing.get("options") or [])
    if not options:
        return None
    return {
        "hotel_id": hotel.tj_hotel_id,
        "name": hotel.name or listing.get("name") or "",
        "stars": hotel.star_rating,
        "property_type": hotel.property_type,
        "address": hotel.address,
        "latitude": hotel.latitude,
        "longitude": hotel.longitude,
        "hero_image": hotel.hero_image,
        "amenities": hotel.amenities[:6],
        "rank": hotel.rank,
        "option": options[0],
    }


def _rooms(q: HotelSearch | HotelPricing) -> list[dict]:
    return [r.to_tripjack() for r in q.rooms]


async def search_stream(
    session: AsyncSession, q: HotelSearch, correlation_id: str | None = None
) -> AsyncIterator[dict]:
    """Yields {"hotels": [...]} as each chunk of Listing answers, then {"done": true, ...}.
    A chunk that fails is skipped; only if every chunk fails is the error raised."""
    region = await resolve_region(session, q)
    correlation_id = correlation_id or new_correlation_id()
    key = _key("search", region.region_id, q.check_in, q.check_out, _rooms(q), q.nationality)
    cached = await _cache_get(key)
    if cached:
        trace.note_cache(cached.get("_trace"))
        yield {"hotels": cached["hotels"], "cached": True}
        yield {"done": True, "correlation_id": cached["correlation_id"], "cached": True,
               "region": cached["region"], "total": len(cached["hotels"])}
        return

    await _ensure_catalogue(session, region)
    hotels = await _candidates(session, region.region_id)
    by_id = {h.tj_hotel_id: h for h in hotels}
    ids = list(by_id)
    chunks = [ids[i : i + CHUNK] for i in range(0, len(ids), CHUNK)]

    async def run(chunk: list[str]) -> list[dict]:
        return await tripjack_hotels.listing(
            hids=chunk,
            check_in=q.check_in.isoformat(),
            check_out=q.check_out.isoformat(),
            rooms=_rooms(q),
            correlation_id=correlation_id,
            nationality=q.nationality,
        )

    cards: list[dict] = []
    failures: list[Exception] = []
    for future in asyncio.as_completed([run(c) for c in chunks]):
        try:
            listing = await future
        except TripJackError as exc:
            failures.append(exc)
            log.warning("listing chunk failed: %s", exc)
            continue
        batch = [
            c for item in listing
            if (h := by_id.get(_listing_id(item))) and (c := _card(h, item))
        ]
        cards.extend(batch)
        if batch:
            yield {"hotels": batch}
    if chunks and len(failures) == len(chunks):
        raise failures[0]

    region_info = {
        "region_id": region.region_id, "city": region.city_name, "country": region.country_name
    }
    if cards:
        await _cache_set(
            key,
            {
                "hotels": cards,
                "correlation_id": correlation_id,
                "region": region_info,
                "_trace": trace.stamp(),
            },
            settings.tripjack_listing_cache_seconds,
        )
    yield {"done": True, "correlation_id": correlation_id, "region": region_info,
           "total": len(cards), "partial": bool(failures)}


async def search(session: AsyncSession, q: HotelSearch) -> dict:
    hotels: list[dict] = []
    meta: dict = {}
    async for event in search_stream(session, q):
        if "hotels" in event:
            hotels.extend(event["hotels"])
        if event.get("done"):
            meta = event
    if q.sort == "rank":
        hotels.sort(key=lambda h: (-h["rank"], h["option"]["price"]["total"]))
    else:
        hotels.sort(key=lambda h: h["option"]["price"]["total"])
    return {**{k: v for k, v in meta.items() if k != "done"}, "hotels": hotels}


async def pricing(session: AsyncSession, hotel_id: str, q: HotelPricing) -> dict:
    """Every bookable option of one hotel, live, with the hotel's static detail."""
    hotel = (
        await session.execute(select(SupplierHotel).where(SupplierHotel.tj_hotel_id == hotel_id))
    ).scalar_one_or_none()
    correlation_id = q.correlation_id or new_correlation_id()
    body = await tripjack_hotels.pricing(
        hid=hotel_id,
        check_in=q.check_in.isoformat(),
        check_out=q.check_out.isoformat(),
        rooms=_rooms(q),
        correlation_id=correlation_id,
        nationality=q.nationality,
    )
    return {
        "correlation_id": correlation_id,
        "hotel": _detail(hotel, body.get("hotelName")),
        "options": normalise_options(body.get("options") or []),
    }


def _detail(hotel: SupplierHotel | None, fallback_name: str | None) -> dict:
    if hotel is None:
        return {"name": fallback_name or ""}
    return {
        "hotel_id": hotel.tj_hotel_id,
        "name": hotel.name or fallback_name or "",
        "stars": hotel.star_rating,
        "property_type": hotel.property_type,
        "address": hotel.address,
        "latitude": hotel.latitude,
        "longitude": hotel.longitude,
        "images": hotel.images,
        "amenities": hotel.amenities,
        "headline": hotel.headline,
        "description": hotel.description,
        "policies": hotel.policies,
    }

