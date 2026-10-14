"""Creators and who they bring in.

Credit rule (first touch wins): a traveller is credited to a creator when they sign up through
the creator's link, or when they paste one of the creator's reels within REFERRAL_WINDOW_DAYS
of joining. A credited traveller earns the creator a commission when they get their first trip
plan.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.creators.models import (
    AttributionEvent,
    AttributionSource,
    CommissionEntry,
    Creator,
    CreatorAttribution,
)
from app.modules.users.models import User


def _code_base(handle: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "", handle.lower())[:48] or "creator"


async def _unique_code(session: AsyncSession, handle: str) -> str:
    base = _code_base(handle)
    code, n = base, 1
    while await session.scalar(select(exists().where(Creator.referral_code == code))):
        n += 1
        code = f"{base}-{n}"
    return code


async def upsert(
    session: AsyncSession, handle: str, display_name: str = "", platform: str = "instagram"
) -> Creator:
    handle = handle.strip().lstrip("@")
    creator = await session.scalar(
        select(Creator).where(Creator.platform == platform, Creator.handle == handle)
    )
    if creator:
        if display_name and not creator.display_name:
            creator.display_name = display_name
        return creator
    creator = Creator(
        platform=platform,
        handle=handle,
        display_name=display_name,
        profile_url=f"https://www.instagram.com/{handle}/" if platform == "instagram" else "",
        referral_code=await _unique_code(session, handle),
        commission_per_user_paise=settings.creator_commission_per_user_paise,
    )
    session.add(creator)
    await session.flush()
    return creator


async def by_code(session: AsyncSession, code: str) -> Creator | None:
    return await session.scalar(select(Creator).where(Creator.referral_code == code.lower()))


def record(
    session: AsyncSession,
    creator: Creator,
    event: AttributionEvent,
    source: AttributionSource,
    *,
    user_id: uuid.UUID | None = None,
    content_id: uuid.UUID | None = None,
    visitor_id: str = "",
) -> None:
    session.add(
        CreatorAttribution(
            creator_id=creator.id,
            user_id=user_id,
            content_id=content_id,
            visitor_id=visitor_id[:64],
            source=source,
            event=event,
        )
    )


async def credit_signup(
    session: AsyncSession, user: User, code: str | None, visitor_id: str = ""
) -> Creator | None:
    """A new account opened through a creator's link."""
    creator = await by_code(session, code) if code else None
    if not creator or user.referred_by_creator_id:
        return None
    user.referred_by_creator_id = creator.id
    record(
        session,
        creator,
        AttributionEvent.SIGNUP,
        AttributionSource.REFERRAL_LINK,
        user_id=user.id,
        visitor_id=visitor_id,
    )
    return creator


async def credit_reel(
    session: AsyncSession, user: User, creator: Creator, content_id: uuid.UUID
) -> bool:
    """A traveller pasted this creator's reel. Credited if they joined recently and have no
    creator yet; always recorded, so staff see which creators inspire trips."""
    record(
        session,
        creator,
        AttributionEvent.REEL_IMPORT,
        AttributionSource.REEL,
        user_id=user.id,
        content_id=content_id,
    )
    joined = user.created_at or datetime.now(UTC)
    recent = datetime.now(UTC) - joined <= timedelta(days=settings.referral_window_days)
    if user.referred_by_creator_id or not recent:
        return False
    user.referred_by_creator_id = creator.id
    return True


async def record_trip_planned(session: AsyncSession, user: User) -> CommissionEntry | None:
    """First trip plan for a credited traveller: log it and book the creator's commission."""
    if not user.referred_by_creator_id:
        return None
    already = await session.scalar(
        select(
            exists().where(
                CommissionEntry.user_id == user.id,
                CommissionEntry.event == AttributionEvent.TRIP_PLANNED,
            )
        )
    )
    if already:
        return None
    creator = await session.get(Creator, user.referred_by_creator_id)
    if not creator:
        return None
    source = await session.scalar(
        select(CreatorAttribution.source)
        .where(
            CreatorAttribution.user_id == user.id,
            CreatorAttribution.creator_id == creator.id,
            CreatorAttribution.event.in_([AttributionEvent.SIGNUP, AttributionEvent.REEL_IMPORT]),
        )
        .order_by(CreatorAttribution.created_at)
        .limit(1)
    )
    record(
        session,
        creator,
        AttributionEvent.TRIP_PLANNED,
        source or AttributionSource.REFERRAL_LINK,
        user_id=user.id,
    )
    entry = CommissionEntry(
        creator_id=creator.id,
        user_id=user.id,
        event=AttributionEvent.TRIP_PLANNED,
        amount_paise=creator.commission_per_user_paise,
    )
    session.add(entry)
    return entry
