import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.knowledge.service import get as get_location
from app.modules.profiles.models import ProfileEvent, TravelerProfile
from app.modules.profiles.schemas import EventCreate, ProfileFields


async def get_profile(session: AsyncSession, user_id: uuid.UUID) -> TravelerProfile | None:
    return await session.get(TravelerProfile, user_id)


async def upsert_profile(
    session: AsyncSession, user_id: uuid.UUID, data: ProfileFields
) -> TravelerProfile:
    profile = await get_profile(session, user_id)
    if profile is None:
        profile = TravelerProfile(user_id=user_id)
        session.add(profile)
    for field, value in data.model_dump().items():
        setattr(profile, field, value)
    await session.flush()
    await session.refresh(profile)
    return profile


async def add_event(session: AsyncSession, user_id: uuid.UUID, data: EventCreate) -> ProfileEvent:
    await get_location(session, data.location_id)
    event = ProfileEvent(user_id=user_id, **data.model_dump())
    session.add(event)
    await session.flush()
    await session.refresh(event)
    return event


async def recent_events(
    session: AsyncSession, user_id: uuid.UUID, limit: int = 200
) -> list[ProfileEvent]:
    rows = await session.scalars(
        select(ProfileEvent)
        .where(ProfileEvent.user_id == user_id)
        .order_by(ProfileEvent.created_at.desc())
        .limit(limit)
    )
    return list(rows)


async def event_counts(session: AsyncSession, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    rows = await session.execute(
        select(ProfileEvent.user_id, func.count())
        .where(ProfileEvent.user_id.in_(user_ids))
        .group_by(ProfileEvent.user_id)
    )
    return dict(rows.all())
