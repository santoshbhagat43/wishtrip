import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator
from app.modules.knowledge.models import Location, LocationStatus, LocationType


@dataclass
class SearchHit:
    location: Location
    similarity: float


async def semantic_search(
    session: AsyncSession,
    ai: AIOrchestrator,
    query: str,
    *,
    types: list[LocationType] | None = None,
    city_id: uuid.UUID | None = None,
    city_ids: list[uuid.UUID] | None = None,
    limit: int = 10,
    min_similarity: float = 0.0,
) -> list[SearchHit]:
    vector = await ai.embed_query(query)
    distance = Location.embedding.cosine_distance(vector)
    stmt = (
        select(Location, distance.label("distance"))
        .where(Location.status == LocationStatus.PUBLISHED, Location.embedding.is_not(None))
        .order_by(distance)
        .limit(limit)
    )
    if types:
        stmt = stmt.where(Location.type.in_(types))
    cities = [*(city_ids or []), *([city_id] if city_id else [])]
    if cities:
        stmt = stmt.where(Location.parent_id.in_(cities) | Location.id.in_(cities))
    rows = (await session.execute(stmt)).unique().all()
    hits = [SearchHit(location=loc, similarity=round(1 - float(dist), 4)) for loc, dist in rows]
    # Iterative HNSW scans return rows in relaxed order; restore exact similarity order.
    hits.sort(key=lambda h: h.similarity, reverse=True)
    return [h for h in hits if h.similarity >= min_similarity]
