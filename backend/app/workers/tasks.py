import asyncio
import uuid

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.ai.indexing import embed_locations
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
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
