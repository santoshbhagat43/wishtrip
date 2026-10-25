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

from sqlalchemy import exists, func, or_, select
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
    CreatorLink,
    CreatorStatus,
)
from app.modules.knowledge.models import Location, LocationStatus, LocationType
from app.modules.reels import service as reels
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


# International format, as the apply form sends it: "+" then 7–15 digits.
_E164 = re.compile(r"\+[1-9]\d{6,14}")


async def _claim_whatsapp(session: AsyncSession, creator: Creator, whatsapp: str) -> None:
    """Store the creator's WhatsApp number for code sign-in, unless another creator has it."""
    if not _E164.fullmatch(whatsapp) or creator.whatsapp == whatsapp:
        return
    taken = await session.scalar(
        select(Creator.id).where(Creator.whatsapp == whatsapp, Creator.id != creator.id)
    )
    if taken is None:
        creator.whatsapp = whatsapp


_INSTAGRAM = re.compile(
    r"^(?:https?://)?(?:www\.)?instagram\.com/@?([A-Za-z0-9._]{1,30})/?(?:[?#].*)?$", re.IGNORECASE
)
_INSTAGRAM_HANDLE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
_YOUTUBE = re.compile(
    r"^(?:https?://)?(?:www\.|m\.)?youtube\.com/"
    r"(@[A-Za-z0-9._-]{3,30}|channel/UC[A-Za-z0-9_-]{20,}|c/[A-Za-z0-9._-]+|user/[A-Za-z0-9._-]+)"
    r"/?(?:[?#].*)?$",
    re.IGNORECASE,
)
_YOUTUBE_HANDLE = re.compile(r"^@?([A-Za-z0-9._-]{3,30})$")


def clean_instagram(value: str) -> str:
    """An Instagram handle from a handle, an @handle or a profile link, in lowercase.

    Instagram handles are case-insensitive, so @Meera and @meera must be the same creator.
    Empty stays empty."""
    value = value.strip()
    if not value:
        return ""
    match = _INSTAGRAM.match(value)
    handle = match.group(1) if match else value.lstrip("@")
    if not _INSTAGRAM_HANDLE.match(handle):
        raise bad_request("That doesn't look like an Instagram handle. Try @yourhandle.")
    return handle.lower()


def clean_youtube(value: str) -> str | None:
    """A canonical YouTube channel link from an @handle, a bare name or a channel link."""
    value = value.strip()
    if not value:
        return None
    match = _YOUTUBE.match(value)
    if match:
        return f"https://www.youtube.com/{match.group(1)}"
    bare = _YOUTUBE_HANDLE.match(value) if "/" not in value else None
    if bare:
        return f"https://www.youtube.com/@{bare.group(1)}"
    raise bad_request("Paste your YouTube channel link, or your @handle.")


_YOUTUBE_VIDEO = re.compile(
    r"^(?:https?://)?(?:(?:www\.|m\.)?youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|live/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?:[?&#/].*)?$",
    re.IGNORECASE,
)


def youtube_video_id(url: str | None) -> str | None:
    """The 11-character id in a (canonical) YouTube video link."""
    match = _YOUTUBE_VIDEO.match((url or "").strip())
    return match.group(1) if match else None


def clean_youtube_video(value: str) -> str:
    """A canonical link to one YouTube video, from a watch, shorts or youtu.be link."""
    match = _YOUTUBE_VIDEO.match(value.strip())
    if not match:
        raise bad_request("Paste the link to your YouTube video, like youtube.com/watch?v=…")
    return f"https://www.youtube.com/watch?v={match.group(1)}"


async def apply_as_creator(
    session: AsyncSession,
    *,
    email: str,
    name: str,
    handle: str = "",
    youtube: str = "",
    whatsapp: str = "",
    followers: str = "",
    posted_from: str = "",
) -> Creator:
    """A creator applies through the website form. Creates a pending creator (keyed by email)
    for staff to approve; the extra details are kept in notes until there's a column for them.

    They give an Instagram handle, a YouTube channel, or both — at least one, since staff have
    nothing to review otherwise."""
    email = email.strip().lower()
    handle = clean_instagram(handle)
    youtube_url = clean_youtube(youtube)
    if not handle and not youtube_url:
        raise bad_request("Add your Instagram, your YouTube, or both, so we can see your work.")
    notes = (
        f"Applied via website. WhatsApp: {whatsapp or '—'} · "
        f"Followers: {followers or '—'} · Posts from: {posted_from or '—'}"
    )
    creator = await session.scalar(select(Creator).where(func.lower(Creator.email) == email))
    if handle and (creator is None or not creator.handle):
        # Instagram handles are unique. One may already belong to a creator we know from reels
        # travellers pasted, or to someone else who applied: say so, rather than crash.
        taken = await session.scalar(
            select(Creator.id).where(
                Creator.platform == "instagram",
                func.lower(Creator.handle) == handle,
                Creator.id != (creator.id if creator else uuid.UUID(int=0)),
            )
        )
        if taken:
            raise conflict(
                f"@{handle} is already registered with another creator. "
                "If it's your account, contact the WishTrip team."
            )
    if creator is None:
        creator = Creator(
            email=email,
            display_name=name.strip(),
            handle=handle or None,
            profile_url=f"https://www.instagram.com/{handle}/" if handle else "",
            youtube_url=youtube_url,
            status=CreatorStatus.PENDING,
            referral_code=await _unique_code(session, handle or email.split("@")[0]),
            commission_per_user_paise=settings.creator_commission_per_user_paise,
            notes=notes,
        )
        session.add(creator)
        await session.flush()
        await _claim_whatsapp(session, creator, whatsapp.strip())
    else:
        await _claim_whatsapp(session, creator, whatsapp.strip())
        if name.strip():
            creator.display_name = name.strip()
        if handle and not creator.handle:
            creator.handle = handle
            creator.profile_url = f"https://www.instagram.com/{handle}/"
        # A re-application can add a channel they left out before, but never overwrite one.
        if youtube_url and not creator.youtube_url:
            creator.youtube_url = youtube_url
        creator.notes = notes
        if creator.status not in (CreatorStatus.ACTIVE, CreatorStatus.PAUSED):
            creator.status = CreatorStatus.PENDING
    return creator


async def by_code(session: AsyncSession, code: str) -> Creator | None:
    """A creator by their referral code, or by their handle: their link is /creator/<either>."""
    wanted = code.strip().lstrip("@").lower()
    return await session.scalar(
        select(Creator).where(
            or_(Creator.referral_code == wanted, func.lower(Creator.handle) == wanted)
        )
        # A referral code beats a handle that happens to read the same.
        .order_by((Creator.referral_code != wanted).asc())
        .limit(1)
    )


async def for_user(session: AsyncSession, user_id: uuid.UUID) -> Creator | None:
    return await session.scalar(select(Creator).where(Creator.user_id == user_id))


async def whatsapp_is_known(session: AsyncSession, phone: str | None) -> bool:
    """Is this WhatsApp number one a creator gave us? Codes are only sent to known numbers."""
    if not phone:
        return False
    return await session.scalar(select(exists().where(Creator.whatsapp == phone))) or False


async def sign_in_creator(
    session: AsyncSession, *, email: str | None = None, whatsapp: str | None = None
) -> User:
    """Return the creator's account once their one-time code has been checked (auth/otp.py),
    creating it on first sign-in.

    By email, a new address lands as a PENDING creator: they see "waiting for approval" until
    staff approve them in the dashboard. By WhatsApp, the number must belong to a creator who has
    applied, since an account needs an email.
    """
    if whatsapp:
        creator = await session.scalar(select(Creator).where(Creator.whatsapp == whatsapp))
        if creator is None or not creator.email:
            raise bad_request(
                "No creator account uses that WhatsApp number. Sign in with email, or apply first."
            )
        email = creator.email
    if not email:
        raise bad_request("An email or a WhatsApp number is needed to sign in.")
    email = email.strip().lower()

    user = await session.scalar(select(User).where(func.lower(User.email) == email))
    if user and user.role == Role.TRAVELER:
        # A traveller who becomes a creator is the same person: keep their account and history.
        user.role = Role.CREATOR
    elif user and user.role != Role.CREATOR:
        raise conflict("This email belongs to a WishTrip team account. Use a different email.")
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
    link_id: uuid.UUID | None = None,
    visitor_id: str = "",
) -> None:
    session.add(
        CreatorAttribution(
            creator_id=creator.id,
            user_id=user_id,
            content_id=content_id,
            link_id=link_id,
            visitor_id=visitor_id[:64],
            source=source,
            event=event,
        )
    )


async def credit_signup(
    session: AsyncSession,
    user: User,
    code: str | None,
    visitor_id: str = "",
    link_code: str | None = None,
) -> Creator | None:
    """A new account opened through a creator's link (and, if it was one, a specific reel link)."""
    creator = await by_code(session, code) if code else None
    if not creator or user.referred_by_creator_id:
        return None
    user.referred_by_creator_id = creator.id
    # The reel link only counts if it is really this creator's: a mismatched pair is ignored.
    link = await link_by_code(session, link_code) if link_code else None
    if link and link.creator_id != creator.id:
        link = None
    if link:
        user.referred_via_link_id = link.id
    record(
        session,
        creator,
        AttributionEvent.SIGNUP,
        AttributionSource.REFERRAL_LINK,
        user_id=user.id,
        link_id=link.id if link else None,
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
        link_id=user.referred_via_link_id,
    )
    entry = CommissionEntry(
        creator_id=creator.id,
        user_id=user.id,
        event=AttributionEvent.TRIP_PLANNED,
        amount_paise=creator.commission_per_user_paise,
    )
    session.add(entry)
    return entry


# --- Reel links ---------------------------------------------------------------------------------
# A creator makes a short link for one reel *before* posting it, uses it in the caption or bio,
# then comes back and adds the Instagram URL. Each link keeps its own numbers.

_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no look-alikes (0/o, 1/l/i)


async def link_by_code(session: AsyncSession, code: str) -> CreatorLink | None:
    return await session.scalar(select(CreatorLink).where(CreatorLink.code == code.strip().lower()))


async def _unique_link_code(session: AsyncSession, label: str) -> str:
    """Short and readable: a word from the label, then four random characters (goa-k3x9)."""
    word = re.sub(r"[^a-z0-9]+", "", label.lower())[:10]
    for _ in range(20):
        suffix = "".join(secrets.choice(_ALPHABET) for _ in range(4))
        code = f"{word}-{suffix}" if word else f"r-{suffix}"
        if not await session.scalar(select(exists().where(CreatorLink.code == code))):
            return code
    raise bad_request("Couldn't make a unique link just now. Try again.")


async def _destination(session: AsyncSession, destination_id: uuid.UUID | None) -> Location | None:
    if destination_id is None:
        return None
    place = await session.get(Location, destination_id)
    if not place or place.type != LocationType.CITY or place.status != LocationStatus.PUBLISHED:
        raise bad_request("Pick one of the destinations from the list.")
    return place


async def create_link(
    session: AsyncSession, creator: Creator, label: str, destination_id: uuid.UUID | None
) -> CreatorLink:
    label = label.strip()
    place = await _destination(session, destination_id)
    link = CreatorLink(
        creator_id=creator.id,
        label=label,
        destination_id=place.id if place else None,
        code=await _unique_link_code(session, place.name if place else label),
    )
    session.add(link)
    await session.flush()
    return link


async def update_link(
    session: AsyncSession,
    link: CreatorLink,
    *,
    label: str | None = None,
    instagram_url: str | None = None,
    clear_instagram: bool = False,
    youtube_url: str | None = None,
    auto_publish: bool | None = None,
) -> CreatorLink:
    if label is not None:
        link.label = label.strip()
    if auto_publish is not None:
        link.auto_publish = auto_publish
    if youtube_url is not None:
        # A blank value removes it again.
        link.youtube_url = clean_youtube_video(youtube_url) if youtube_url.strip() else None
    if clear_instagram:
        link.instagram_url = None
        link.instagram_shortcode = None
    elif instagram_url is not None:
        shortcode = reels.shortcode_from(instagram_url)
        if not shortcode:
            raise bad_request("Paste the link to your Instagram reel, like instagram.com/reel/…")
        taken = await session.scalar(
            select(CreatorLink.id).where(
                CreatorLink.instagram_shortcode == shortcode, CreatorLink.id != link.id
            )
        )
        if taken:
            raise conflict("That reel is already attached to another of your links.")
        link.instagram_url = reels.canonical_url(shortcode)
        link.instagram_shortcode = shortcode
    await session.flush()
    return link


async def visit_link(
    session: AsyncSession, code: str, visitor_id: str = ""
) -> tuple[Creator, CreatorLink] | None:
    """Someone opened a reel link: credit the creator and the link."""
    link = await link_by_code(session, code)
    creator = await session.get(Creator, link.creator_id) if link else None
    if not link or not creator:
        return None
    record(
        session,
        creator,
        AttributionEvent.VISIT,
        AttributionSource.REFERRAL_LINK,
        link_id=link.id,
        visitor_id=visitor_id,
    )
    return creator, link


async def link_stats(session: AsyncSession, link_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Visits, sign-ups, trips planned and earnings for each link."""
    stats = {
        i: {"visits": 0, "signups": 0, "trips_planned": 0, "earned_paise": 0} for i in link_ids
    }
    if not link_ids:
        return stats
    for link_id, n in await session.execute(
        select(CreatorAttribution.link_id, func.count())
        .where(
            CreatorAttribution.link_id.in_(link_ids),
            CreatorAttribution.event == AttributionEvent.VISIT,
        )
        .group_by(CreatorAttribution.link_id)
    ):
        stats[link_id]["visits"] = n
    for link_id, n in await session.execute(
        select(User.referred_via_link_id, func.count())
        .where(User.referred_via_link_id.in_(link_ids))
        .group_by(User.referred_via_link_id)
    ):
        stats[link_id]["signups"] = n
    for link_id, n in await session.execute(
        select(CreatorAttribution.link_id, func.count())
        .where(
            CreatorAttribution.link_id.in_(link_ids),
            CreatorAttribution.event == AttributionEvent.TRIP_PLANNED,
        )
        .group_by(CreatorAttribution.link_id)
    ):
        stats[link_id]["trips_planned"] = n
    for link_id, paise in await session.execute(
        select(User.referred_via_link_id, func.coalesce(func.sum(CommissionEntry.amount_paise), 0))
        .join(User, User.id == CommissionEntry.user_id)
        .where(User.referred_via_link_id.in_(link_ids), CommissionEntry.status != "void")
        .group_by(User.referred_via_link_id)
    ):
        stats[link_id]["earned_paise"] = int(paise)
    return stats
