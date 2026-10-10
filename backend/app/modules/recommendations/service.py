import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator
from app.modules.knowledge.models import PLACE_TYPES, Location, LocationStatus, LocationType, Tag
from app.modules.profiles import service as profiles
from app.modules.recommendations.engine import (
    PreferenceOverrides,
    Preferences,
    ScoredLocation,
    build_preferences,
    passes_hard_constraints,
    rank,
)

CANDIDATE_LIMIT = 200


async def load_preferences(
    session: AsyncSession, user_id: uuid.UUID, overrides: PreferenceOverrides | None = None
) -> Preferences:
    profile = await profiles.get_profile(session, user_id)
    events = await profiles.recent_events(session, user_id)
    event_location_ids = {e.location_id for e in events}
    event_tags: dict[uuid.UUID, list[uuid.UUID]] = {}
    if event_location_ids:
        for loc in (
            await session.scalars(select(Location).where(Location.id.in_(event_location_ids)))
        ).unique():
            event_tags[loc.id] = [t.id for t in loc.tags]
    interest_ids = list(profile.interest_tag_ids or []) if profile else []
    if overrides:
        interest_ids += overrides.tag_ids
    names = (
        list(await session.scalars(select(Tag.name).where(Tag.id.in_(interest_ids))))
        if interest_ids
        else []
    )
    return build_preferences(profile, events, event_tags, names, overrides)


async def candidate_search(
    session: AsyncSession,
    ai: AIOrchestrator,
    prefs: Preferences,
    *,
    city_id: uuid.UUID | None,
    types: list[LocationType] | None,
) -> list[tuple[Location, float | None]]:
    """Published places that could plausibly fit, with semantic similarity when available."""
    stmt = select(Location).where(
        Location.status == LocationStatus.PUBLISHED,
        Location.type.in_(types or PLACE_TYPES),
    )
    if city_id:
        stmt = stmt.where(Location.parent_id == city_id)

    if prefs.query_text:
        vector = await ai.embed_query(prefs.query_text)
        distance = Location.embedding.cosine_distance(vector)
        stmt = stmt.add_columns(distance.label("distance")).order_by(distance.nulls_last())
        rows = (await session.execute(stmt.limit(CANDIDATE_LIMIT))).unique().all()
        candidates = [
            (loc, None if dist is None else round(1 - float(dist), 4)) for loc, dist in rows
        ]
    else:
        rows = (await session.scalars(stmt.order_by(Location.name).limit(CANDIDATE_LIMIT))).unique()
        candidates = [(loc, None) for loc in rows]

    return [(loc, sim) for loc, sim in candidates if passes_hard_constraints(loc, prefs)]


async def recommend(
    session: AsyncSession,
    ai: AIOrchestrator,
    user_id: uuid.UUID,
    *,
    city_id: uuid.UUID | None = None,
    types: list[LocationType] | None = None,
    limit: int = 10,
    overrides: PreferenceOverrides | None = None,
) -> tuple[Preferences, list[ScoredLocation]]:
    prefs = await load_preferences(session, user_id, overrides)
    candidates = await candidate_search(session, ai, prefs, city_id=city_id, types=types)
    return prefs, rank(candidates, prefs, limit)
