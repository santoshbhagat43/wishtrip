"""Turns knowledge-base locations into embeddings for semantic search and chat retrieval."""

import logging
import uuid

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator
from app.modules.knowledge.models import Location, LocationStatus

logger = logging.getLogger(__name__)
BATCH_SIZE = 32


def stale_embedding_clause(model_name: str):
    """Published rows with no embedding, an outdated one, or one from a different model."""
    return or_(
        Location.embedded_at.is_(None),
        Location.embedded_at < Location.updated_at,
        Location.embedding_model.is_distinct_from(model_name),
    )


def location_document(location: Location, parent_name: str | None = None) -> str:
    """The text the embedding represents: what a traveler might search for."""
    parts = [f"{location.name} ({location.type})"]
    if parent_name:
        parts.append(f"in {parent_name}")
    parts += [location.summary, location.description]
    if location.tags:
        parts.append("Tags: " + ", ".join(t.name for t in location.tags))
    if location.best_times:
        parts.append("Best time: " + ", ".join(location.best_times))
    if location.seasons:
        parts.append("Seasons: " + ", ".join(location.seasons))
    if location.family_friendly:
        parts.append("family friendly")
    if location.couple_friendly:
        parts.append("good for couples")
    if location.pros:
        parts.append("Pros: " + "; ".join(location.pros))
    if location.tips:
        parts.append("Tips: " + location.tips)
    return "\n".join(p for p in parts if p)


async def embed_locations(
    session: AsyncSession, ai: AIOrchestrator, location_ids: list[uuid.UUID] | None = None
) -> int:
    """Embed the given locations, or every published location whose embedding is stale."""
    query = select(Location).where(Location.status == LocationStatus.PUBLISHED)
    if location_ids is not None:
        query = query.where(Location.id.in_(location_ids))
    else:
        query = query.where(stale_embedding_clause(ai.embedder.name))
    locations = list((await session.scalars(query)).unique())
    for start in range(0, len(locations), BATCH_SIZE):
        batch = locations[start : start + BATCH_SIZE]
        docs = [location_document(loc, loc.parent.name if loc.parent else None) for loc in batch]
        vectors = await ai.embed(docs, "document")
        for location, vector in zip(batch, vectors, strict=True):
            # Keep updated_at as-is: embedding is derived data, not an edit.
            await session.execute(
                update(Location)
                .where(Location.id == location.id)
                .values(
                    embedding=vector,
                    embedded_at=func.now(),
                    embedding_model=ai.embedder.name,
                    updated_at=Location.updated_at,
                )
            )
    await session.commit()
    logger.info("Embedded %d locations", len(locations))
    return len(locations)
