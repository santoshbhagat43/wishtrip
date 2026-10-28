"""What a traveller sees when they open one stop of a shared trip: the hotel a stay is (or the
closest ones when the reel's name matches none), and what WishTrip knows about a place.

Only what we hold is shown: the TripJack hotel's own content, our checked place's facts, the
creator's note. No prices and nothing invented."""

import uuid

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.creators.models import CreatorTrip
from app.modules.hotels import matching, photos
from app.modules.hotels.models import SupplierHotel
from app.modules.knowledge.models import Location, LocationStatus


class HotelPhoto(BaseModel):
    url: str
    caption: str = ""


class HotelDetail(BaseModel):
    id: uuid.UUID
    name: str
    stars: float | None = None
    property_type: str = ""
    address: str = ""
    city: str = ""
    country: str = ""
    headline: str = ""
    description: str = ""
    amenities: list[str] = []
    images: list[HotelPhoto] = []


class Alternative(BaseModel):
    hotel: HotelDetail
    # Why we suggest it, in words: "Close to the name in the reel" or "Well rated in Bali".
    reason: str


class PlaceFacts(BaseModel):
    summary: str = ""
    description: str = ""
    address: str = ""
    duration_minutes: int | None = None
    best_times: list[str] = []
    price_note: str = ""
    pros: list[str] = []
    cons: list[str] = []
    tips: str = ""


class StopDetails(BaseModel):
    id: str
    kind: str
    name: str
    note: str = ""
    origin: str = "reel"
    at_seconds: float | None = None
    # A stay's own hotel (a confident or staff-confirmed match), or else the closest alternatives.
    hotel: HotelDetail | None = None
    alternatives: list[Alternative] = []
    place: PlaceFacts | None = None


def hotel_detail(h: SupplierHotel, *, photos_max: int = 8) -> HotelDetail:
    images = [
        HotelPhoto(url=i["url"], caption=i.get("caption") or "")
        for i in (h.images or [])
        if isinstance(i, dict) and i.get("url")
    ]
    if h.hero_image and all(i.url != h.hero_image for i in images):
        images.insert(0, HotelPhoto(url=h.hero_image))
    return HotelDetail(
        id=h.id,
        name=h.name,
        stars=h.star_rating,
        property_type=h.property_type,
        address=h.address,
        city=h.city,
        country=h.country,
        headline=h.headline,
        description=h.description,
        amenities=[a for a in (h.amenities or []) if isinstance(a, str)][:16],
        images=images[:photos_max],
    )


async def _top_in_destination(
    session: AsyncSession, destination: str, skip: set[uuid.UUID], limit: int
) -> list[SupplierHotel]:
    regions = await photos._regions_for(session, destination, [])
    if not regions:
        return []
    rows = await session.scalars(
        select(SupplierHotel)
        .where(
            SupplierHotel.region_id.in_([r.region_id for r in regions]),
            SupplierHotel.is_active.is_(True),
            SupplierHotel.hero_image.is_not(None),
        )
        .order_by(SupplierHotel.rank.desc())
        .limit(limit + len(skip))
    )
    return [h for h in rows if h.id not in skip][:limit]


async def alternatives(
    session: AsyncSession, stay: str, destination: str, limit: int = 3
) -> list[Alternative]:
    """Hotels to suggest when the stay in the reel is no hotel we hold: those whose names are
    nearest first, then the best-presented hotels of the destination."""
    out: list[Alternative] = []
    seen: set[uuid.UUID] = set()
    for hotel, value in await photos.ranked(session, stay, destination, limit=limit):
        if value >= 0.3 and hotel.hero_image:
            out.append(
                Alternative(hotel=hotel_detail(hotel), reason="Close to the name in the reel")
            )
            seen.add(hotel.id)
    if len(out) < limit:
        where = destination or "this area"
        for hotel in await _top_in_destination(session, destination, seen, limit - len(out)):
            out.append(Alternative(hotel=hotel_detail(hotel), reason=f"Well presented in {where}"))
    return out[:limit]


async def _place(session: AsyncSession, location_id: str | None) -> PlaceFacts | None:
    if not location_id:
        return None
    try:
        key = uuid.UUID(location_id)
    except ValueError:
        return None
    loc = await session.get(Location, key)
    if loc is None or loc.status != LocationStatus.PUBLISHED:
        return None
    return PlaceFacts(
        summary=loc.summary,
        description=loc.description,
        address=loc.address,
        duration_minutes=loc.duration_minutes,
        best_times=list(loc.best_times or []),
        price_note=loc.price_note,
        pros=list(loc.pros or []),
        cons=list(loc.cons or []),
        tips=loc.tips,
    )


async def stop_details(
    session: AsyncSession, trip: CreatorTrip, item_id: str
) -> StopDetails | None:
    item = next((i for i in trip.items or [] if str(i.get("id")) == item_id), None)
    if item is None:
        return None
    details = StopDetails(
        id=item_id,
        kind=item.get("kind", ""),
        name=item.get("name", ""),
        note=item.get("note", ""),
        origin=item.get("origin", "reel"),
        at_seconds=item.get("t"),
        place=await _place(session, item.get("location_id")),
    )
    if details.kind == "stay":
        found = (await photos.resolve(session, trip.id, [item], trip.destination_name)).get(
            item_id[:40]
        )
        if found and found.state in photos.SHOWN and found.hotel is not None:
            details.hotel = hotel_detail(found.hotel)
        elif not found or found.state != "unlinked":
            details.alternatives = await alternatives(
                session, matching.clean_name(details.name), trip.destination_name
            )
    return details
