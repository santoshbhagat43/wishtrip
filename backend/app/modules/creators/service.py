"""Creators and who they bring in.

Credit rule (first touch wins): a traveller is credited to a creator when they sign up through
the creator's link, or when they paste one of the creator's reels within REFERRAL_WINDOW_DAYS
of joining. A credited traveller earns the creator a commission when they get their first trip
plan.
"""

import logging
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import bad_request, conflict
from app.core.security import hash_password
from app.modules.creators.models import (
    AttributionEvent,
    AttributionSource,
    CommissionEntry,
    Creator,
    CreatorAttribution,
    CreatorStatus,
)
from app.modules.users.models import Role, User

logger = logging.getLogger(__name__)


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


async def for_user(session: AsyncSession, user_id: uuid.UUID) -> Creator | None:
    return await session.scalar(select(Creator).where(Creator.user_id == user_id))


def send_otp(email: str) -> None:
    """Email the creator a one-time code. No SMTP yet, so the fixed dev code is only logged."""
    logger.info("Creator OTP for %s: %s (dev code)", email, settings.creator_dev_otp)


async def login_with_otp(session: AsyncSession, email: str, code: str) -> User:
    """Verify the code and return the creator's account, creating it on first sign-in.

    A new account lands as a PENDING creator: they see "waiting for approval" until staff
    approve them in the dashboard.
    """
    email = email.strip().lower()
    if code.strip() != settings.creator_dev_otp:
        raise bad_request("That code isn't right. Check the 4-digit code and try again.")

    user = await session.scalar(select(User).where(func.lower(User.email) == email))
    if user and user.role != Role.CREATOR:
        raise conflict("This email already has a traveller account. Use a different email.")
    if user is None:
        # No password sign-in for creators; a random hash keeps the column non-guessable.
        user = User(
            email=email,
            hashed_password=hash_password(secrets.token_urlsafe(24)),
            role=Role.CREATOR,
        )
        session.add(user)
        await session.flush()

    creator = await for_user(session, user.id) or await session.scalar(
        select(Creator).where(func.lower(Creator.email) == email)
    )
    if creator is None:
        creator = Creator(
            email=email,
            status=CreatorStatus.PENDING,
            user_id=user.id,
            referral_code=await _unique_code(session, email.split("@")[0]),
            commission_per_user_paise=settings.creator_commission_per_user_paise,
        )
        session.add(creator)
        await session.flush()
    elif creator.user_id is None:
        creator.user_id = user.id
    return user


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
