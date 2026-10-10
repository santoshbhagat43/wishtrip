import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_staff
from app.core.pagination import Page
from app.db.session import get_session
from app.modules.knowledge.models import Location, LocationStatus
from app.modules.knowledge.schemas import LocationRef, PublicLocation
from app.modules.profiles import service
from app.modules.profiles.models import EventType, ProfileEvent, TravelerProfile
from app.modules.profiles.schemas import (
    EventCreate,
    EventRead,
    ProfileFields,
    ProfileRead,
    RecentEvent,
    TravelerDetail,
    TravelerSummary,
)
from app.modules.users import service as users
from app.modules.users.models import Role, User

router = APIRouter(tags=["profiles"])


@router.get("/profiles/me", response_model=ProfileRead)
async def my_profile(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    profile = await service.get_profile(session, user.id)
    return profile or ProfileRead(user_id=user.id)


@router.put("/profiles/me", response_model=ProfileRead)
async def update_my_profile(
    data: ProfileFields,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    profile = await service.upsert_profile(session, user.id, data)
    await session.commit()
    return profile


class SavedPlace(BaseModel):
    place: PublicLocation
    saved_at: datetime


@router.get("/profiles/me/saved", response_model=list[SavedPlace])
async def my_saved_places(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    """Places whose latest signal is a save (added/selected/booked) — not later removed/skipped."""
    latest: dict[uuid.UUID, ProfileEvent] = {}
    for event in await service.recent_events(session, user.id, limit=500):
        latest.setdefault(event.location_id, event)  # newest first
    saved = {
        loc_id: e.created_at
        for loc_id, e in latest.items()
        if e.event_type in (EventType.ADDED, EventType.SELECTED, EventType.BOOKED)
    }
    if not saved:
        return []
    places = (
        await session.scalars(
            select(Location).where(
                Location.id.in_(saved), Location.status == LocationStatus.PUBLISHED
            )
        )
    ).unique()
    rows = [
        SavedPlace(place=PublicLocation.model_validate(p), saved_at=saved[p.id]) for p in places
    ]
    return sorted(rows, key=lambda r: r.saved_at, reverse=True)


@router.post("/profiles/me/events", response_model=EventRead, status_code=201)
async def record_event(
    data: EventCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Behavioral signal: the traveler selected, skipped, removed... a location."""
    event = await service.add_event(session, user.id, data)
    await session.commit()
    return event


@router.get("/admin/travelers", response_model=Page[TravelerSummary])
async def list_travelers(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    rows, total = await users.list_users(session, Role.TRAVELER, page, page_size)
    ids = [u.id for u in rows]
    profiles = {
        p.user_id: p
        for p in await session.scalars(
            select(TravelerProfile).where(TravelerProfile.user_id.in_(ids))
        )
    }
    counts = await service.event_counts(session, ids)
    items = [
        TravelerSummary(
            user_id=u.id,
            email=u.email,
            full_name=u.full_name,
            profile=ProfileRead.model_validate(profiles[u.id]) if u.id in profiles else None,
            event_count=counts.get(u.id, 0),
        )
        for u in rows
    ]
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/admin/travelers/{user_id}", response_model=TravelerDetail)
async def traveler_detail(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    user = await users.get(session, user_id)
    profile = await service.get_profile(session, user_id)
    events = await service.recent_events(session, user_id, limit=50)
    locations = {
        loc.id: loc
        for loc in (
            await session.scalars(
                select(Location).where(Location.id.in_({e.location_id for e in events}))
            )
        ).unique()
    }
    return TravelerDetail(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        profile=ProfileRead.model_validate(profile) if profile else None,
        event_count=len(events),
        recent_events=[
            RecentEvent(
                event=EventRead.model_validate(e),
                location=LocationRef.model_validate(locations[e.location_id]),
            )
            for e in events
            if e.location_id in locations
        ],
    )
