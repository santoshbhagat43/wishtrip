import uuid

from app.ai.indexing import embed_locations
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
from app.db.session import SessionLocal


async def schedule_embedding(location_ids: list[uuid.UUID] | None = None) -> None:
    """Queue (or, in inline mode, run) embedding for locations. None means all stale ones."""
    if settings.embeddings_inline:
        async with SessionLocal() as session:
            await embed_locations(session, AIOrchestrator(), location_ids)
        return
    from app.workers.tasks import embed_locations_task

    payload = [str(i) for i in location_ids] if location_ids is not None else None
    embed_locations_task.delay(payload)
