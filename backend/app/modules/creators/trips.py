"""Creator-owned itineraries: built from a creator's own reel, edited, then published as a
shareable, affiliate-tagged link."""

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import bad_request, not_found
from app.modules.creators.models import Creator, CreatorLink, CreatorTrip, TripStatus
from app.modules.media.storage import storage

ITEM_KINDS = {"stay", "food", "sight", "experience", "area", "note"}


def _slug(text: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:32] or "trip"


async def _unique_share_code(session: AsyncSession, destination: str) -> str:
    base = _slug(destination)
    while True:
        code = f"{base}-{secrets.token_urlsafe(4).lower().replace('_', '').replace('-', '')[:6]}"
        if not await session.scalar(select(exists().where(CreatorTrip.share_code == code))):
            return code


def _item_from_place(place: dict) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "kind": place.get("kind") if place.get("kind") in ITEM_KINDS else "sight",
        "name": place.get("location_name") or place.get("name") or "",
        "note": place.get("evidence") or "",
        "day": None,
        "location_id": place.get("location_id"),
        "verified": bool(place.get("verified")),
        # Where in the reel it was seen, in seconds.
        "t": place.get("t"),
    }


async def finish_import(session: AsyncSession, job, content) -> CreatorTrip:
    """Turn a processed reel into a draft trip owned by the creator who imported it."""
    creator = await session.scalar(select(Creator).where(Creator.user_id == job.user_id))
    if creator is None:
        raise not_found("Creator")
    extracted = content.extracted or {}
    trip = CreatorTrip(
        creator_id=creator.id,
        title=f"{content.destination_name or 'My'} trip",
        destination_name=content.destination_name or extracted.get("destination", ""),
        summary=extracted.get("summary", ""),
        cover_image_key=content.thumbnail_key,
        source_shortcode=content.shortcode,
        items=[_item_from_place(p) for p in content.places],
    )
    session.add(trip)
    await session.flush()
    job.content_id = content.id
    job.creator_trip_id = trip.id
    # A reel link that asked for it publishes the moment its itinerary exists.
    link = await session.scalar(select(CreatorLink).where(CreatorLink.import_id == job.id))
    if link is not None and link.auto_publish and trip.items:
        await publish(session, trip)
    # status/step set DONE by the caller's commit path
    from app.modules.reels.models import ImportStatus, ImportStep

    job.status, job.step, job.error = ImportStatus.DONE, ImportStep.DONE, ""
    job.finished_at = datetime.now(UTC)
    await session.commit()
    return trip


async def create_from_content(
    session: AsyncSession,
    creator: Creator,
    content,
    *,
    title: str | None = None,
    items: list | None = None,
) -> CreatorTrip:
    """A creator's trip from a processed reel's content (their own draft to publish)."""
    extracted = content.extracted or {}
    trip = CreatorTrip(
        creator_id=creator.id,
        title=title or f"{content.destination_name or 'My'} trip",
        destination_name=content.destination_name or extracted.get("destination", ""),
        summary=extracted.get("summary", ""),
        cover_image_key=content.thumbnail_key,
        source_shortcode=content.shortcode,
        items=clean_items(items) if items else [_item_from_place(p) for p in content.places],
    )
    session.add(trip)
    await session.flush()
    return trip


async def require_creator(session: AsyncSession, user_id: uuid.UUID) -> Creator:
    creator = await session.scalar(select(Creator).where(Creator.user_id == user_id))
    if creator is None:
        raise not_found("Creator")
    return creator


async def list_for_creator(session: AsyncSession, creator_id: uuid.UUID) -> list[CreatorTrip]:
    rows = await session.scalars(
        select(CreatorTrip)
        .where(CreatorTrip.creator_id == creator_id)
        .order_by(CreatorTrip.created_at.desc())
    )
    return list(rows)


async def owned(session: AsyncSession, trip_id: uuid.UUID, creator_id: uuid.UUID) -> CreatorTrip:
    trip = await session.get(CreatorTrip, trip_id)
    if trip is None or trip.creator_id != creator_id:
        raise not_found("Trip")
    return trip


def clean_items(items: list) -> list:
    out = []
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()[:200]
        if not name:
            continue
        day = raw.get("day")
        out.append(
            {
                "id": str(raw.get("id") or uuid.uuid4().hex)[:40],
                "kind": raw.get("kind") if raw.get("kind") in ITEM_KINDS else "sight",
                "name": name,
                "note": str(raw.get("note") or "").strip()[:500],
                "day": day if isinstance(day, int) and 0 < day <= 60 else None,
                "location_id": raw.get("location_id"),
                "verified": bool(raw.get("verified")),
                "t": raw.get("t") if isinstance(raw.get("t"), int | float) else None,
            }
        )
    return out[:100]


async def publish(session: AsyncSession, trip: CreatorTrip) -> CreatorTrip:
    if not trip.items:
        raise bad_request("Add at least one stop before publishing.")
    if not trip.share_code:
        trip.share_code = await _unique_share_code(session, trip.destination_name or trip.title)
    trip.status = TripStatus.PUBLISHED
    return trip


def cover_url(trip: CreatorTrip) -> str | None:
    return storage.url(trip.cover_image_key) if trip.cover_image_key else None
