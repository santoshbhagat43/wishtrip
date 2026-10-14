import asyncio
import uuid

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.ai.indexing import embed_locations
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
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
