import asyncio
import uuid

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.ai.indexing import embed_locations
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
from app.modules.hotels import sync as hotel_sync
from app.modules.reels import service as reels
from app.modules.reels.models import ReelImport
from app.workers.celery_app import celery_app


async def _embed(location_ids: list[uuid.UUID] | None) -> int:
    # Each task runs in its own event loop, so it needs its own engine.
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            return await embed_locations(session, AIOrchestrator(), location_ids)
    finally:
        await engine.dispose()


@celery_app.task(
    name="knowledge.embed_locations", autoretry_for=(Exception,), retry_backoff=True, max_retries=3
)
def embed_locations_task(location_ids: list[str] | None = None) -> int:
    ids = [uuid.UUID(i) for i in location_ids] if location_ids is not None else None
    return asyncio.run(_embed(ids))


async def _process_reel(import_id: uuid.UUID) -> None:
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            job = await session.get(ReelImport, import_id)
            if job is not None:
                await reels.process(session, AIOrchestrator(), job)
    finally:
        await engine.dispose()


# No autoretry: process() records its own failure on the import for the traveller to read,
# and retrying a blocked Instagram download only makes the block last longer.
@celery_app.task(name="reels.process", soft_time_limit=600, time_limit=660)
def process_reel_task(import_id: str) -> None:
    asyncio.run(_process_reel(uuid.UUID(import_id)))


async def _hotel_sync(job: str, region_id: int | None = None) -> int:
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            if job == "regions":
                n = await hotel_sync.sync_regions(session)
                await hotel_sync.link_regions_to_locations(session)
                return n
            if job == "destinations":
                return len(await hotel_sync.sync_destination_photos(session))
            assert region_id is not None
            if job == "region":
                await hotel_sync.sync_region_mapping(session, region_id)
            return await hotel_sync.sync_region_content(session, region_id)
    finally:
        await engine.dispose()


@celery_app.task(
    name="hotels.sync_regions", autoretry_for=(Exception,), retry_backoff=True, max_retries=3
)
def sync_regions_task() -> int:
    return asyncio.run(_hotel_sync("regions"))


# Hotel ids, then the content of every hotel in one region (100 a call).
@celery_app.task(
    name="hotels.sync_region", autoretry_for=(Exception,), retry_backoff=True, max_retries=3
)
def sync_region_task(region_id: int) -> int:
    return asyncio.run(_hotel_sync("region", region_id))


# Content only: used after a first search already pulled the ids and the first batch.
@celery_app.task(
    name="hotels.sync_region_content", autoretry_for=(Exception,), retry_backoff=True, max_retries=3
)
def sync_region_content_task(region_id: int) -> int:
    return asyncio.run(_hotel_sync("content", region_id))


async def _complete_trip(trip_id: str, shown: list[dict] | None) -> None:
    from app.modules.creators import trips

    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            await trips.complete_in_background(session, uuid.UUID(trip_id), AIOrchestrator(), shown)
    finally:
        await engine.dispose()


# A creator's trip, topped up after they already have the video's own places. On the default
# queue (network-bound model calls), not the media queue that is busy reading the next reel.
@celery_app.task(name="trips.complete", soft_time_limit=300, time_limit=330)
def complete_trip_task(trip_id: str, shown: list[dict] | None = None) -> None:
    asyncio.run(_complete_trip(trip_id, shown))


# Transactional emails (creator onboarding, sign-in codes): rendered and sent by SMTP.
@celery_app.task(name="emails.send", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def send_email_task(name: str, to: str, variables: dict) -> bool:
    from app.modules.emails import service as emails

    if not emails.configured():
        return False  # nothing to send with (logged by deliver_now); retrying would not help
    if not emails.deliver_now(name, to, variables):
        raise RuntimeError(f"email {name} to {to} was not sent")  # retried with backoff
    return True


# TripJack photos for the hotels a creator's trip stays at (matched by name once fetched).
async def _trip_hotel_photos(trip_id: str) -> int:
    from app.modules.creators.models import CreatorTrip
    from app.modules.hotels import photos

    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            trip = await session.get(CreatorTrip, uuid.UUID(trip_id))
            if trip is None:
                return 0
            return await photos.fetch_for_trip(
                session, trip.id, trip.items or [], trip.destination_name
            )
    finally:
        await engine.dispose()


@celery_app.task(
    name="hotels.trip_photos", autoretry_for=(Exception,), retry_backoff=True, max_retries=2
)
def trip_hotel_photos_task(trip_id: str) -> int:
    return asyncio.run(_trip_hotel_photos(trip_id))


# A few hotel photos for every published destination (the Destinations page's pictures).
@celery_app.task(
    name="hotels.sync_destination_photos",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=2,
)
def sync_destination_photos_task() -> int:
    return asyncio.run(_hotel_sync("destinations"))
