"""Read-only traveler view of the knowledge base: published data only, no internal fields."""

import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.db.session import get_session
from app.modules.knowledge.models import (
    CONTAINER_TYPES,
    Location,
    LocationRelation,
    LocationStatus,
    LocationType,
    Tag,
    TagCategory,
)
from app.modules.knowledge.schemas import LocationRef, PublicLocation, TagRead
from app.modules.media.models import Media, MediaKind
from app.modules.media.storage import storage

router = APIRouter(prefix="/explore", tags=["explore"])
PUBLISHED = Location.status == LocationStatus.PUBLISHED


class Destination(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    region: str
    country: str | None
    summary: str
    latitude: float | None
    longitude: float | None
    place_count: int
    highlights: list[str]


class DestinationDetail(BaseModel):
    destination: Destination
    places: list[PublicLocation]


class PublicMedia(BaseModel):
    kind: MediaKind
    url: str
    caption: str
    author: str


class Nearby(BaseModel):
    place: LocationRef
    relation: str
    travel_minutes: int | None


class PlaceDetail(PublicLocation):
    model_config = ConfigDict(from_attributes=True)

    description: str
    pros: list[str]
    cons: list[str]
    tips: str
    seasons: list[str]
    opening_hours: dict
    energy_level: int | None
    difficulty: int | None
    media: list[PublicMedia] = []
    nearby: list[Nearby] = []


async def _destinations(
    session: AsyncSession, city_ids: list[uuid.UUID] | None = None
) -> list[Destination]:
    query = select(Location).where(Location.type == LocationType.CITY, PUBLISHED)
    if city_ids is not None:
        query = query.where(Location.id.in_(city_ids))
    cities = list((await session.scalars(query.order_by(Location.name))).unique())
    if not cities:
        return []
    ids = [c.id for c in cities]
    counts = dict(
        (
            await session.execute(
                select(Location.parent_id, func.count())
                .where(
                    Location.parent_id.in_(ids), PUBLISHED, Location.type.not_in(CONTAINER_TYPES)
                )
                .group_by(Location.parent_id)
            )
        ).all()
    )
    highlight_rows = (
        await session.execute(
            select(Location.parent_id, Location.name)
            .where(Location.parent_id.in_(ids), PUBLISHED, Location.highlight.is_(True))
            .order_by(Location.name)
        )
    ).all()
    highlights: dict[uuid.UUID, list[str]] = {}
    for parent_id, name in highlight_rows:
        highlights.setdefault(parent_id, []).append(name)
    return [
        Destination(
            id=c.id,
            name=c.name,
            slug=c.slug,
            region=c.region,
            country=c.parent.name if c.parent else None,
            summary=c.summary,
            latitude=c.latitude,
            longitude=c.longitude,
            place_count=counts.get(c.id, 0),
            highlights=highlights.get(c.id, [])[:3],
        )
        for c in cities
        if counts.get(c.id, 0) > 0
    ]


@router.get("/destinations", response_model=list[Destination])
async def destinations(session: AsyncSession = Depends(get_session)):
    """Published cities that have at least one published place."""
    return await _destinations(session)


@router.get("/destinations/{city_id}", response_model=DestinationDetail)
async def destination(
    city_id: uuid.UUID,
    type: list[LocationType] | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    found = await _destinations(session, [city_id])
    if not found:
        raise not_found("Destination")
    query = select(Location).where(
        Location.parent_id == city_id, PUBLISHED, Location.type.not_in(CONTAINER_TYPES)
    )
    if type:
        query = query.where(Location.type.in_(type))
    places = (
        await session.scalars(query.order_by(Location.highlight.desc(), Location.name))
    ).unique()
    return DestinationDetail(
        destination=found[0], places=[PublicLocation.model_validate(p) for p in places]
    )


@router.get("/places/{place_id}", response_model=PlaceDetail)
async def place(place_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    location = await session.scalar(select(Location).where(Location.id == place_id, PUBLISHED))
    if location is None or location.type in CONTAINER_TYPES:
        raise not_found("Place")
    detail = PlaceDetail.model_validate(location)
    media = await session.scalars(
        select(Media)
        .where(Media.location_id == place_id)
        .order_by(Media.sort_order, Media.created_at)
    )
    detail.media = [
        PublicMedia(
            kind=m.kind,
            caption=m.caption,
            author=m.author,
            url=storage.url(m.storage_key) if m.storage_key else (m.external_url or ""),
        )
        for m in media
    ]
    relations = (
        await session.scalars(
            select(LocationRelation).where(
                or_(LocationRelation.source_id == place_id, LocationRelation.target_id == place_id)
            )
        )
    ).unique()
    for rel in relations:
        other = rel.target if rel.source_id == place_id else rel.source
        if other.status == LocationStatus.PUBLISHED:
            detail.nearby.append(
                Nearby(
                    place=LocationRef.model_validate(other),
                    relation=rel.relation.value,
                    travel_minutes=rel.travel_minutes,
                )
            )
    return detail


@router.get("/tags", response_model=list[TagRead])
async def tags(session: AsyncSession = Depends(get_session)):
    """Interest/style/cuisine tags travelers can pick as preferences."""
    rows = await session.scalars(
        select(Tag).where(Tag.category != TagCategory.AMENITY).order_by(Tag.category, Tag.name)
    )
    return list(rows)
