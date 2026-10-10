import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.deps import get_current_user, require_staff
from app.db.session import get_session
from app.modules.knowledge.models import LocationType
from app.modules.knowledge.schemas import LocationListItem, PublicLocation
from app.modules.knowledge.service import to_list_item
from app.modules.recommendations import service
from app.modules.recommendations.engine import RANKING_WEIGHTS, Preferences, ScoredLocation
from app.modules.users import service as users
from app.modules.users.models import User

router = APIRouter(tags=["recommendations"])


class RecommendationItem(BaseModel):
    # Staff previews get the full list item; travelers get PublicLocation.
    location: LocationListItem | PublicLocation
    score: float
    similarity: float | None
    components: dict[str, float]
    reasons: list[str]
    warnings: list[str]


class PreferenceSummary(BaseModel):
    energy_level: int | None
    budget_level: int | None
    companions: str | None
    preferred_times: list[str]
    accessibility_needs: bool
    interest_tag_count: int
    query_text: str


class RecommendationResponse(BaseModel):
    preferences: PreferenceSummary
    weights: dict[str, float]
    items: list[RecommendationItem]


def _response(
    prefs: Preferences, scored: list[ScoredLocation], *, staff: bool
) -> RecommendationResponse:
    return RecommendationResponse(
        preferences=PreferenceSummary(
            energy_level=prefs.energy_level,
            budget_level=prefs.budget_level,
            companions=prefs.companions,
            preferred_times=sorted(prefs.preferred_times),
            accessibility_needs=prefs.accessibility_needs,
            interest_tag_count=len([w for w in prefs.tag_weights.values() if w > 0]),
            query_text=prefs.query_text,
        ),
        weights=RANKING_WEIGHTS,
        items=[
            RecommendationItem(
                location=(
                    to_list_item(s.location) if staff else PublicLocation.model_validate(s.location)
                ),
                score=s.score,
                similarity=s.similarity,
                components=s.components,
                reasons=s.reasons,
                warnings=s.warnings,
            )
            for s in scored
        ],
    )


@router.get("/recommendations", response_model=RecommendationResponse)
async def my_recommendations(
    city_id: uuid.UUID | None = None,
    type: list[LocationType] | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    user: User = Depends(get_current_user),
):
    prefs, scored = await service.recommend(
        session, ai, user.id, city_id=city_id, types=type, limit=limit
    )
    return _response(prefs, scored, staff=False)


@router.get("/admin/recommendations/preview", response_model=RecommendationResponse)
async def preview_recommendations(
    user_id: uuid.UUID,
    city_id: uuid.UUID | None = None,
    type: list[LocationType] | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    _: User = Depends(require_staff),
):
    """Inspector for staff: what would this traveler be recommended, and why."""
    await users.get(session, user_id)
    prefs, scored = await service.recommend(
        session, ai, user_id, city_id=city_id, types=type, limit=limit
    )
    return _response(prefs, scored, staff=True)
