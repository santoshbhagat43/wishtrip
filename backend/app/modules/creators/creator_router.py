"""Creator-facing endpoints: a signed-in creator builds trips from their own reels, edits them,
and publishes shareable affiliate links. Plus the public endpoint those links resolve to."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.config import settings
from app.core.deps import get_current_user
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.creators import service, trips
from app.modules.creators.models import Creator, CreatorLink, CreatorStatus, CreatorTrip
from app.modules.creators.schemas import (
    CreatorLinkCreate,
    CreatorLinkRead,
    CreatorLinkUpdate,
    CreatorTripRead,
    CreatorTripUpdate,
    LinkDestination,
    LinkStats,
    LinkVisit,
    PublicCreator,
    PublicTripRead,
    ReferralVisit,
    SaveFromReel,
    TripImportStart,
)
from app.modules.knowledge.models import Location
from app.modules.reels import service as reels
from app.modules.reels.models import CreatorContent, ImportKind, ReelImport
from app.modules.reels.schemas import ReelImportRead
from app.modules.users.models import User

router = APIRouter(tags=["creator"])


def trip_read(trip: CreatorTrip) -> CreatorTripRead:
    data = CreatorTripRead.model_validate(trip)
    data.cover_image_url = trips.cover_url(trip)
    return data


async def _active_creator(session: AsyncSession, user: User) -> Creator:
    creator = await trips.require_creator(session, user.id)
    if creator.status != CreatorStatus.ACTIVE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your creator account isn't approved yet.")
    return creator


@router.post("/creator/trips/import", response_model=ReelImportRead, status_code=201)
async def import_reel(
    data: TripImportStart,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    user: User = Depends(get_current_user),
):
    """Build a trip from one of the creator's own reels (same pipeline as a traveller paste)."""
    await _active_creator(session, user)
    shortcode = reels.shortcode_from(data.url)
    if not shortcode:
        raise bad_request("Paste an Instagram reel link, like instagram.com/reel/…")
    if await reels.recent_count(session, user.id) >= settings.reel_imports_per_hour:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "That's a lot of reels. Try later.")
    job = ReelImport(
        url=reels.canonical_url(shortcode),
        shortcode=shortcode,
        user_id=user.id,
        kind=ImportKind.CREATOR_TRIP,
    )
    session.add(job)
    await session.commit()
    if settings.reels_inline:
        await reels.process(session, ai, job)
    else:
        from app.workers.tasks import process_reel_task

        process_reel_task.delay(str(job.id))
    await session.refresh(job)
    return ReelImportRead.model_validate(job, from_attributes=True)


@router.get("/creator/trips/imports/{import_id}", response_model=ReelImportRead)
async def import_status(
    import_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = await session.get(ReelImport, import_id)
    if not job or job.user_id != user.id:
        raise not_found("Import")
    return ReelImportRead.model_validate(job, from_attributes=True)


@router.get("/creator/trips", response_model=list[CreatorTripRead])
async def list_trips(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    creator = await trips.require_creator(session, user.id)
    return [trip_read(t) for t in await trips.list_for_creator(session, creator.id)]


@router.get("/creator/trips/{trip_id}", response_model=CreatorTripRead)
async def get_trip(
    trip_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    creator = await trips.require_creator(session, user.id)
    return trip_read(await trips.owned(session, trip_id, creator.id))


@router.patch("/creator/trips/{trip_id}", response_model=CreatorTripRead)
async def update_trip(
    trip_id: uuid.UUID,
    data: CreatorTripUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    creator = await trips.require_creator(session, user.id)
    trip = await trips.owned(session, trip_id, creator.id)
    if data.title is not None:
        trip.title = data.title.strip() or trip.title
    if data.summary is not None:
        trip.summary = data.summary.strip()
    if data.items is not None:
        trip.items = trips.clean_items([i.model_dump() for i in data.items])
    if data.publish:
        await trips.publish(session, trip)
    await session.commit()
    await session.refresh(trip)
    return trip_read(trip)


@router.post("/creator/trips/from-reel", response_model=CreatorTripRead, status_code=201)
async def save_from_reel(
    data: SaveFromReel,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Save a creator's reel-based trip and publish its affiliate link in one step."""
    creator = await _active_creator(session, user)
    job = await session.get(ReelImport, data.import_id)
    if not job or job.user_id != user.id:
        raise not_found("Reel")
    content = await session.get(CreatorContent, job.content_id) if job.content_id else None
    if content is None:
        raise bad_request("That reel isn't ready yet.")
    trip = await trips.create_from_content(
        session,
        creator,
        content,
        title=data.title,
        items=[i.model_dump() for i in data.items] if data.items is not None else None,
    )
    await trips.publish(session, trip)
    await session.commit()
    await session.refresh(trip)
    return trip_read(trip)


@router.get("/trips/{share_code}", response_model=PublicTripRead)
async def public_trip(share_code: str, session: AsyncSession = Depends(get_session)):
    """The shareable affiliate link. Public, so a creator can put it in their video."""
    from sqlalchemy import select

    from app.modules.creators.models import TripStatus

    trip = await session.scalar(select(CreatorTrip).where(CreatorTrip.share_code == share_code))
    if not trip or trip.status != TripStatus.PUBLISHED:
        raise not_found("Trip")
    creator = await session.get(Creator, trip.creator_id)
    assert creator is not None
    return PublicTripRead(
        title=trip.title,
        destination_name=trip.destination_name,
        summary=trip.summary,
        cover_image_url=trips.cover_url(trip),
        creator=PublicCreator(
            handle=creator.handle,
            display_name=creator.display_name or (creator.handle or "A wishtrip creator"),
            referral_code=creator.referral_code,
        ),
        items=trip.items,
    )


# --- Reel links ---------------------------------------------------------------------------------


async def _link_read(session: AsyncSession, links: list[CreatorLink]) -> list[CreatorLinkRead]:
    stats = await service.link_stats(session, [link.id for link in links])
    places = {
        p.id: p
        for p in await session.scalars(
            select(Location).where(
                Location.id.in_([link.destination_id for link in links if link.destination_id])
            )
        )
    }
    return [
        CreatorLinkRead(
            id=link.id,
            code=link.code,
            label=link.label,
            destination=(
                LinkDestination(
                    id=places[link.destination_id].id,
                    name=places[link.destination_id].name,
                    region=places[link.destination_id].region,
                )
                if link.destination_id in places
                else None
            ),
            instagram_url=link.instagram_url,
            status="live" if link.instagram_url else "waiting",
            created_at=link.created_at,
            stats=LinkStats(**stats[link.id]),
        )
        for link in links
    ]


async def _own_link(session: AsyncSession, creator: Creator, link_id: uuid.UUID) -> CreatorLink:
    link = await session.get(CreatorLink, link_id)
    if not link or link.creator_id != creator.id:
        raise not_found("Link")
    return link


@router.get("/creator/links", response_model=list[CreatorLinkRead])
async def my_links(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    """The creator's reel links with each one's own numbers, newest first."""
    creator = await trips.require_creator(session, user.id)
    links = list(
        await session.scalars(
            select(CreatorLink)
            .where(CreatorLink.creator_id == creator.id)
            .order_by(CreatorLink.created_at.desc())
        )
    )
    return await _link_read(session, links)


@router.post("/creator/links", response_model=CreatorLinkRead, status_code=201)
async def create_my_link(
    data: CreatorLinkCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Make a short link for a reel you are about to post. The Instagram URL comes later."""
    creator = await _active_creator(session, user)
    link = await service.create_link(session, creator, data.label, data.destination_id)
    await session.commit()
    await session.refresh(link)
    return (await _link_read(session, [link]))[0]


@router.patch("/creator/links/{link_id}", response_model=CreatorLinkRead)
async def change_my_link(
    link_id: uuid.UUID,
    data: CreatorLinkUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Add the Instagram URL once the reel is posted, or rename the link."""
    creator = await _active_creator(session, user)
    link = await _own_link(session, creator, link_id)
    sent = data.model_dump(exclude_unset=True)
    await service.update_link(
        session,
        link,
        label=data.label,
        instagram_url=(data.instagram_url or None) if "instagram_url" in sent else None,
        clear_instagram="instagram_url" in sent and not (data.instagram_url or "").strip(),
    )
    await session.commit()
    await session.refresh(link)
    return (await _link_read(session, [link]))[0]


@router.post("/referrals/links/{code}/visit", response_model=LinkVisit)
async def visit_reel_link(
    code: str, data: ReferralVisit, session: AsyncSession = Depends(get_session)
):
    """A reel link was opened: credit the creator and the link, and say where to send them."""
    found = await service.visit_link(session, code, data.visitor_id)
    if not found:
        raise not_found("Link")
    creator, link = found
    await session.commit()
    return LinkVisit(
        referral_code=creator.referral_code,
        link_code=link.code,
        destination_id=link.destination_id,
    )
