"""Creators on the public site: the Creator trips page and a creator's own page.

Only real, published data is shown: approved creators who have a handle and at least one
published trip. Nothing here is a number we don't have (no followers, ratings or bookings)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.db.session import get_session
from app.modules.creators import trips
from app.modules.creators.models import Creator, CreatorStatus, CreatorTrip, TripStatus
from app.modules.media.storage import storage
from app.modules.reels import service as reels

router = APIRouter(prefix="/explore/creators", tags=["explore"])


class PublicTripCard(BaseModel):
    share_code: str
    title: str
    destination_name: str
    summary: str
    days: int
    stops: int
    cover_image_url: str | None = None
    # The creator's own reel or video, when it came from a link we can show.
    source_url: str | None = None


class PublicCreatorCard(BaseModel):
    # The address of their page, /creator/<slug>: their handle, or their referral code until staff
    # have set one.
    slug: str
    # Their Instagram or YouTube handle, when staff have set it.
    handle: str | None = None
    display_name: str
    channel: str
    profile_url: str
    # Their own profile photo, when they have added one.
    avatar_url: str | None = None
    cover_image_url: str | None = None
    trips: list[PublicTripCard]


class CreatorsIndex(BaseModel):
    creators: int
    trips: int
    stops: int
    spotlight: PublicCreatorCard | None = None
    # True when staff picked the spotlight trip; false when it is the creator with most trips.
    spotlight_chosen: bool = False
    all: list[PublicCreatorCard]


class CreatorPage(BaseModel):
    creator: PublicCreatorCard
    more: list[PublicCreatorCard]


def source_url(shortcode: str | None) -> str | None:
    if not shortcode or shortcode.startswith("upload-"):
        return None
    if shortcode.startswith(reels.YOUTUBE_PREFIX):
        return f"https://www.youtube.com/watch?v={shortcode[len(reels.YOUTUBE_PREFIX):]}"
    return reels.canonical_url(shortcode)


def trip_card(trip: CreatorTrip) -> PublicTripCard:
    items = [i for i in trip.items or [] if (i.get("name") or "").strip()]
    return PublicTripCard(
        share_code=trip.share_code or "",
        title=trip.title,
        destination_name=trip.destination_name,
        summary=trip.summary,
        days=len({i.get("day") or 1 for i in items}) or 1,
        stops=len(items),
        cover_image_url=trips.cover_url(trip),
        source_url=source_url(trip.source_shortcode),
    )


def creator_card(creator: Creator, published: list[CreatorTrip]) -> PublicCreatorCard:
    handle = (creator.handle or "").lstrip("@")
    cards = [trip_card(t) for t in published]
    return PublicCreatorCard(
        slug=handle or creator.referral_code,
        handle=handle or None,
        display_name=creator.display_name or handle or "WishTrip creator",
        channel=creator.platform if creator.platform in ("instagram", "youtube") else "instagram",
        profile_url=creator.profile_url or creator.youtube_url or "",
        avatar_url=storage.url(creator.avatar_key) if creator.avatar_key else None,
        # Their own cover photo first; otherwise a picture from their newest trip.
        cover_image_url=(
            storage.url(creator.cover_key)
            if creator.cover_key
            else next((c.cover_image_url for c in cards if c.cover_image_url), None)
        ),
        trips=cards,
    )


async def eligible(session: AsyncSession) -> list[tuple[Creator, CreatorTrip]]:
    """Every (creator, trip) that can be shown: an approved creator and a published trip with its
    link, newest trip first. A creator needs no handle: their page is at their referral code until
    one is set."""
    rows = (
        await session.execute(
            select(Creator, CreatorTrip)
            .join(CreatorTrip, CreatorTrip.creator_id == Creator.id)
            .where(
                Creator.status == CreatorStatus.ACTIVE,
                CreatorTrip.status == TripStatus.PUBLISHED,
                CreatorTrip.share_code.is_not(None),
            )
            .order_by(CreatorTrip.updated_at.desc())
        )
    ).all()
    return [(c, t) for c, t in rows]


Grouped = list[tuple[Creator, list[CreatorTrip]]]


def group(rows: list[tuple[Creator, CreatorTrip]]) -> Grouped:
    by_creator: dict[object, tuple[Creator, list[CreatorTrip]]] = {}
    for creator, trip in rows:
        by_creator.setdefault(creator.id, (creator, []))[1].append(trip)
    return list(by_creator.values())


def automatic(grouped: Grouped) -> tuple[Creator, list[CreatorTrip]] | None:
    """When staff haven't chosen: the creator with the most published trips (the newest of them
    if they tie)."""
    return max(grouped, key=lambda g: len(g[1]), default=None)


async def _featured(session: AsyncSession) -> list[PublicCreatorCard]:
    """Every creator who can be shown, in the order of their newest published trip."""
    return [creator_card(c, t) for c, t in group(await eligible(session))]


@router.get("", response_model=CreatorsIndex)
async def creators_index(session: AsyncSession = Depends(get_session)):
    grouped = group(await eligible(session))
    cards = [creator_card(c, t) for c, t in grouped]
    # The spotlight: the trip staff chose (with its creator), else whoever has the most trips.
    chosen = next(((c, ts, t) for c, ts in grouped for t in ts if t.spotlight), None)
    spotlight = None
    if chosen:
        creator, creator_trips, trip = chosen
        # The chosen trip leads; the creator's other trips follow.
        spotlight = creator_card(
            creator, [trip, *[t for t in creator_trips if t.id != trip.id]]
        )
    elif (auto := automatic(grouped)) is not None:
        spotlight = creator_card(*auto)
    return CreatorsIndex(
        creators=len(cards),
        trips=sum(len(c.trips) for c in cards),
        stops=sum(t.stops for c in cards for t in c.trips),
        spotlight=spotlight,
        spotlight_chosen=chosen is not None,
        all=cards,
    )


@router.get("/{slug}", response_model=CreatorPage)
async def creator_page(slug: str, session: AsyncSession = Depends(get_session)):
    wanted = slug.strip().lstrip("@").lower()
    cards = await _featured(session)
    mine = next((c for c in cards if c.slug.lower() == wanted), None)
    if mine is None:
        raise not_found("Creator")
    more = [c for c in cards if c.slug != mine.slug][:3]
    # Cards on this page link out; the full trip lists stay with the creator's own page.
    return CreatorPage(
        creator=mine, more=[c.model_copy(update={"trips": c.trips[:1]}) for c in more]
    )



