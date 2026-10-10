import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.deps import get_current_user
from app.db.session import get_session
from app.modules.knowledge.models import LocationType
from app.modules.knowledge.schemas import PublicLocation
from app.modules.search.service import semantic_search
from app.modules.users.models import User

router = APIRouter(prefix="/search", tags=["search"])


class SearchResult(BaseModel):
    location: PublicLocation
    similarity: float


class SearchResponse(BaseModel):
    query: str
    embedder: str
    results: list[SearchResult]


@router.get("/semantic", response_model=SearchResponse)
async def search(
    q: str = Query(min_length=2),
    type: list[LocationType] | None = Query(None),
    city_id: uuid.UUID | None = None,
    limit: int = Query(10, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    _: User = Depends(get_current_user),
):
    hits = await semantic_search(session, ai, q, types=type, city_id=city_id, limit=limit)
    return SearchResponse(
        query=q,
        embedder=ai.embedder.name,
        results=[
            SearchResult(
                location=PublicLocation.model_validate(h.location), similarity=h.similarity
            )
            for h in hits
        ],
    )
