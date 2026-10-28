"""Creator-owned itineraries: built from a creator's own reel, edited, then published as a
shareable, affiliate-tagged link."""

import copy
import logging
import secrets
import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
from app.core.errors import bad_request, not_found
from app.modules.creators.models import Creator, CreatorLink, CreatorTrip, TripStatus
from app.modules.media.storage import storage
from app.modules.reels.complete import (
    MIN_DAYS,
    MIN_STOPS_PER_DAY,
    STOPS_PER_DAY,
    Plan,
    complete,
    target_days,
)

logger = logging.getLogger(__name__)

ITEM_KINDS = {"stay", "food", "sight", "experience", "area", "note", "travel"}
ORIGINS = {"reel", "kb", "suggested", "creator"}


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
        # The day the video itself says it is on, when it does.
        "video_day": place.get("video_day"),
        # Where the stop came from: "reel" (the creator's video), "kb" (WishTrip's checked
        # knowledge base) or "suggested" (the AI's suggestion, neither from the video nor checked).
        "origin": "reel",
    }


def stated_days(items: list[dict]) -> int:
    """The last day the video says any of its places is on (0 when it states none)."""
    return max((i.get("video_day") or 0 for i in items if i["kind"] != "stay"), default=0)


def assign_days(items: list[dict], days: int) -> list[dict]:
    """Spread a trip's stops over its days.

    The places the video named keep the video's order, in chunks, so a day reads as part of the
    video; the stops added to complete the trip then go to whichever day has the fewest. Every day
    ends up with about the same, and a stay goes on day 1 (check-in), not counted among the stops.
    """
    stops = [i for i in items if i["kind"] != "stay"]
    named = [i for i in stops if i.get("origin", "reel") == "reel"]
    added = [i for i in stops if i.get("origin", "reel") != "reel"]
    # A day the creator's video states is theirs: that place goes on that day, and the days run at
    # least that far. A place the video names with no day sits with the one mentioned before it
    # (or the next one, at the very start), so it stays with the part of the video it came from.
    stated = stated_days(items)
    days = max(1, min(max(days, stated), len(stops) or 1))
    counts = [0] * days
    if stated:
        current = next(i["video_day"] for i in named if i.get("video_day"))
        for item in named:
            current = item.get("video_day") or current
            d = min(current, days)
            item["day"] = d
            counts[d - 1] += 1
    else:
        base, extra = divmod(len(named), days)
        n = 0
        for d in range(days):
            for _ in range(base + (1 if d < extra else 0)):
                named[n]["day"] = d + 1
                counts[d] += 1
                n += 1
    for item in added:
        d = counts.index(min(counts))
        item["day"] = d + 1
        counts[d] += 1
    for item in items:
        if item["kind"] == "stay":
            item["day"] = 1
    # Check in first, then the days in order (the sort keeps each day's own order).
    return sorted(items, key=lambda i: (i["kind"] != "stay", i["day"] or 0))


def _stay_first(items: list[dict]) -> list[dict]:
    """An arrangement that already set every day: check in first, the days in order."""
    for item in items:
        if item["kind"] == "stay":
            item["day"] = 1
    return sorted(items, key=lambda i: (i["kind"] != "stay", i["day"] or 0))


def _complete_later(named: list[dict], days_hint: int | None, ai: AIOrchestrator | None) -> bool:
    """Top the trip up in the background? Only when the video's own places already make a trip
    of at least two days (so it can be shown as it is) and some are still missing."""
    if not (settings.complete_itineraries and settings.complete_trips_in_background):
        return False
    if ai is None or not ai.enabled:
        return False
    stops = [i for i in named if i["kind"] != "stay"]
    enough = len(stops) >= MIN_DAYS * MIN_STOPS_PER_DAY
    missing = target_days(days_hint) * STOPS_PER_DAY - len(stops)
    return enough and missing > 0


async def finish_import(session: AsyncSession, job, content, ai: AIOrchestrator | None = None):
    """Turn a processed reel into a draft trip owned by the creator who imported it.

    The places the video names are topped up to a whole trip (see `reels.complete`). That takes
    two model calls, so when the video's own places already make a trip, the creator gets those
    straight away and the rest are added in the background (`complete_in_background`)."""
    creator = await session.scalar(select(Creator).where(Creator.user_id == job.user_id))
    if creator is None:
        raise not_found("Creator")
    extracted = content.extracted or {}
    named = [_item_from_place(p) for p in content.places if p.get("kind") != "area"]
    later = _complete_later(named, extracted.get("days_hint"), ai)
    if later:
        stops = [i for i in named if i["kind"] != "stay"]
        days = max(
            MIN_DAYS,
            stated_days(named),
            min(target_days(extracted.get("days_hint")), len(stops) // MIN_STOPS_PER_DAY),
        )
        plan = Plan(items=named, days=days)
    elif settings.complete_itineraries:
        plan = await complete(
            session,
            ai,
            destination=content.destination_name or extracted.get("destination", ""),
            destination_id=content.destination_id,
            summary=extracted.get("summary", ""),
            items=named,
            days_hint=extracted.get("days_hint"),
        )
    else:
        stops = [i for i in named if i["kind"] != "stay"]
        plan = Plan(items=named, days=min(target_days(extracted.get("days_hint")), len(stops) or 1))
    trip = CreatorTrip(
        creator_id=creator.id,
        title=f"{content.destination_name or 'My'} trip",
        destination_name=content.destination_name or extracted.get("destination", ""),
        summary=extracted.get("summary", ""),
        cover_image_key=content.thumbnail_key,
        thumbnail_image_key=content.thumbnail_key,
        source_shortcode=content.shortcode,
        items=_stay_first(plan.items) if plan.arranged else assign_days(plan.items, plan.days),
        completing=later,
    )
    session.add(trip)
    await session.flush()
    job.content_id = content.id
    job.creator_trip_id = trip.id
    # A reel link that asked for it publishes the moment its itinerary exists (once it is whole).
    link = await session.scalar(select(CreatorLink).where(CreatorLink.import_id == job.id))
    if link is not None and link.auto_publish and trip.items and not later:
        await publish(session, trip)
    # status/step set DONE by the caller's commit path
    from app.modules.reels.models import ImportStatus, ImportStep

    job.status, job.step, job.error = ImportStatus.DONE, ImportStep.DONE, ""
    job.finished_at = datetime.now(UTC)
    await session.commit()
    if later:
        await _queue_completion(session, trip.id, list(trip.items), ai)
    return trip


async def _queue_completion(
    session: AsyncSession, trip_id: uuid.UUID, shown: list[dict], ai: AIOrchestrator | None
) -> None:
    if settings.reels_inline:
        await complete_in_background(session, trip_id, ai, shown)
        return
    from app.workers.tasks import complete_trip_task

    try:
        complete_trip_task.delay(str(trip_id), shown)
    except Exception:  # noqa: BLE001 - the broker is down: top it up now rather than never
        logger.exception("Could not queue the top-up of trip %s; doing it now", trip_id)
        await complete_in_background(session, trip_id, ai, shown)


def _stops(items: list[dict] | None) -> list[tuple]:
    """What the creator can change about the stops, to tell whether they did."""
    return [
        (i.get("id"), i.get("name"), i.get("kind"), i.get("day"), i.get("note"))
        for i in items or []
    ]


async def complete_in_background(
    session: AsyncSession,
    trip_id: uuid.UUID,
    ai: AIOrchestrator | None,
    shown: list[dict] | None = None,
) -> None:
    """Top a trip up to a whole trip after the creator already has the video's own places
    (`shown`: the stops as they were first shown).

    If the creator changed the stops since, their version wins and nothing is added. Either way
    the trip stops being 'completing', and a reel link that asked to auto-publish does so."""
    from app.modules.reels.models import CreatorContent, ReelImport

    trip = await session.get(CreatorTrip, trip_id)
    if trip is None or not trip.completing:
        return
    started = time.monotonic()
    before = copy.deepcopy(list(trip.items or []))
    edited = shown is not None and _stops(before) != _stops(shown)
    content = await session.scalar(
        select(CreatorContent).where(CreatorContent.shortcode == trip.source_shortcode)
    )
    items: list[dict] | None = None
    if content is not None and not edited:
        extracted = content.extracted or {}
        try:
            plan = await complete(
                session,
                ai,
                destination=trip.destination_name,
                destination_id=content.destination_id,
                summary=extracted.get("summary", ""),
                items=copy.deepcopy(before),
                days_hint=extracted.get("days_hint"),
            )
            items = _stay_first(plan.items) if plan.arranged else assign_days(plan.items, plan.days)
        except Exception:  # noqa: BLE001 - the trip stays as the video made it
            logger.exception("Could not top up trip %s", trip_id)
    await session.refresh(trip)  # the creator may have edited it while we worked
    added = 0
    if items is not None and _stops(trip.items) == _stops(before):
        trip.items = items
        added = len(items) - len(before)
    trip.completing = False
    job = await session.scalar(select(ReelImport).where(ReelImport.creator_trip_id == trip.id))
    link = (
        await session.scalar(select(CreatorLink).where(CreatorLink.import_id == job.id))
        if job is not None
        else None
    )
    if link is not None and link.auto_publish and trip.items:
        await publish(session, trip)
    if job is not None:
        job.log = [
            *(job.log or []),
            {
                "at": datetime.now(UTC).isoformat(),
                "message": (
                    f"Topped up in the background: {added} stops added"
                    if items is not None and added
                    else "Not topped up: the creator changed the stops first"
                    if edited or items is not None
                    else "Not topped up: the suggestions could not be made"
                ),
                "seconds": round(time.monotonic() - started, 1),
            },
        ]
    await session.commit()


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
        thumbnail_image_key=content.thumbnail_key,
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
                "video_day": raw.get("video_day") if isinstance(raw.get("video_day"), int) else None,
                "origin": raw.get("origin") if raw.get("origin") in ORIGINS else "reel",
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


COVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024
COVER_UPLOAD_TYPES = {".jpg", ".jpeg", ".png", ".webp"}


def _upload_prefix(trip: CreatorTrip) -> str:
    return f"creator-covers/{trip.id}/"


async def cover_options(session: AsyncSession, trip: CreatorTrip) -> list[dict]:
    """The images the creator can pick as the trip's cover: frames from the video, the reel's own
    cover, and anything they uploaded for this trip. The current one is flagged."""
    from app.modules.reels.models import CreatorContent

    content = (
        await session.scalar(
            select(CreatorContent).where(CreatorContent.shortcode == trip.source_shortcode)
        )
        if trip.source_shortcode
        else None
    )
    options: list[dict] = []
    if content is not None:
        options += [
            {"key": f["key"], "t": f.get("t"), "source": "video"} for f in content.frames or []
        ]
        if content.thumbnail_key:
            options.append({"key": content.thumbnail_key, "t": None, "source": "reel_cover"})
    for held in (trip.cover_image_key, trip.thumbnail_image_key):
        if held and all(o["key"] != held for o in options):
            # An image they uploaded earlier, or one from before frames were kept.
            options.append({"key": held, "t": None, "source": "upload"})
    return [
        {
            **o,
            "url": storage.url(o["key"]),
            "current": o["key"] == trip.cover_image_key,
            "thumbnail_current": o["key"] == (trip.thumbnail_image_key or trip.cover_image_key),
        }
        for o in options
    ]


async def set_image(session: AsyncSession, trip: CreatorTrip, field: str, key: str) -> None:
    """Choose the trip's cover (`cover_image_key`) or reel thumbnail (`thumbnail_image_key`)."""
    allowed = {o["key"] for o in await cover_options(session, trip)}
    if key not in allowed and not key.startswith(_upload_prefix(trip)):
        raise bad_request("Pick one of the images offered for this trip.")
    setattr(trip, field, key)


# The smallest pictures a creator's page looks good with, and the largest we will decode.
PAGE_COVER_MIN = (1200, 400)
PAGE_AVATAR_MIN = (200, 200)
IMAGE_MAX_SIDE = 12_000


def check_image_size(data: bytes, minimum: tuple[int, int], what: str) -> None:
    """Reject a picture that can't be read, is too small to look good, or is absurdly large."""
    import io

    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise bad_request("That image couldn't be read.") from None
    if width < minimum[0] or height < minimum[1]:
        raise bad_request(
            f"Your {what} is {width}×{height}px. Use one at least {minimum[0]}×{minimum[1]}px."
        )
    if max(width, height) > IMAGE_MAX_SIDE:
        raise bad_request(
            f"Your {what} is too large. Use one under {IMAGE_MAX_SIDE}px on its longest side."
        )


def save_image_upload(
    filename: str,
    data_base64: str,
    folder: str,
    *,
    minimum: tuple[int, int] | None = None,
    what: str = "image",
) -> str:
    """Store an uploaded image (JPG, PNG or WebP, up to 4 MB) and return its storage key. With a
    `minimum` size, a smaller picture is refused."""
    import base64
    import binascii
    from pathlib import Path

    suffix = Path(filename).suffix.lower()
    if suffix not in COVER_UPLOAD_TYPES:
        raise bad_request("Upload a JPG, PNG or WebP image.")
    try:
        data = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise bad_request("That image couldn't be read.") from None
    if not data or len(data) > COVER_UPLOAD_MAX_BYTES:
        raise bad_request("Use an image under 4 MB.")
    if minimum:
        check_image_size(data, minimum, what)
    return storage.save(data, f"image{suffix}", folder)


def save_cover_upload(trip: CreatorTrip, filename: str, data_base64: str) -> str:
    return save_image_upload(filename, data_base64, _upload_prefix(trip).rstrip("/"))


def cover_url(trip: CreatorTrip) -> str | None:
    return storage.url(trip.cover_image_key) if trip.cover_image_key else None


def thumbnail_url(trip: CreatorTrip) -> str | None:
    """The reel's thumbnail; the cover until one is chosen."""
    key = trip.thumbnail_image_key or trip.cover_image_key
    return storage.url(key) if key else None
