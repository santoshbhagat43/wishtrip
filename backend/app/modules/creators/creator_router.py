"""Creator-facing endpoints: a signed-in creator builds trips from their own reels, edits them,
and publishes shareable affiliate links. Plus the public endpoint those links resolve to."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.config import settings
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.creators import service, trips
from app.modules.creators.acting import Acting, acting_as
from app.modules.creators.models import (
    Creator,
    CreatorLink,
    CreatorStatus,
    CreatorTrip,
    TripStatus,
)
from app.modules.creators.schemas import (
    CoverOption,
    CoverUpload,
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
from app.modules.media.storage import storage
from app.modules.reels import service as reels
from app.modules.reels.models import CreatorContent, ImportKind, ImportStatus, ReelImport
from app.modules.reels.schemas import ReelImportRead
from app.modules.users.models import User

router = APIRouter(tags=["creator"])


def trip_read(trip: CreatorTrip) -> CreatorTripRead:
    data = CreatorTripRead.model_validate(trip)
    data.cover_image_url = trips.cover_url(trip)
    return data


def _active(acting: Acting) -> Creator:
    if acting.creator.status != CreatorStatus.ACTIVE:
        who = "The creator's" if acting.staff else "Your"
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{who} creator account isn't approved yet.")
    return acting.creator


@router.post("/creator/trips/import", response_model=ReelImportRead, status_code=201)
async def import_reel(
    data: TripImportStart,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    acting: Acting = Depends(acting_as),
):
    """Build a trip from one of the creator's own reels (same pipeline as a traveller paste)."""
    _active(acting)
    shortcode = reels.shortcode_from(data.url)
    if not shortcode:
        raise bad_request("Paste an Instagram reel link, like instagram.com/reel/…")
    job = await _start_import(session, ai, acting.user, shortcode)
    return ReelImportRead.model_validate(job, from_attributes=True)


async def _start_import(
    session: AsyncSession,
    ai: AIOrchestrator,
    user: User,
    shortcode: str,
    link: CreatorLink | None = None,
    upload_key: str | None = None,
) -> ReelImport:
    """Queue the reel → itinerary job (and run it now when there's no worker), noting it on the
    reel link it was started for."""
    if await reels.recent_count(session, user.id) >= settings.reel_imports_per_hour:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "That's a lot of reels. Try later.")
    job = ReelImport(
        url="" if upload_key else reels.canonical_url(shortcode),
        shortcode=shortcode,
        upload_key=upload_key,
        user_id=user.id,
        kind=ImportKind.CREATOR_TRIP,
    )
    session.add(job)
    await session.flush()
    if link is not None:
        link.import_id = job.id
    await session.commit()
    if settings.reels_inline:
        await reels.process(session, ai, job)
    else:
        from app.workers.tasks import process_reel_task

        process_reel_task.delay(str(job.id))
    await session.refresh(job)
    return job


@router.get("/creator/trips/imports/{import_id}", response_model=ReelImportRead)
async def import_status(
    import_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    acting: Acting = Depends(acting_as),
):
    job = await session.get(ReelImport, import_id)
    if not job or job.user_id != acting.user.id:
        raise not_found("Import")
    return ReelImportRead.model_validate(job, from_attributes=True)


@router.get("/creator/trips", response_model=list[CreatorTripRead])
async def list_trips(
    session: AsyncSession = Depends(get_session), acting: Acting = Depends(acting_as)
):
    creator = acting.creator
    return [trip_read(t) for t in await trips.list_for_creator(session, creator.id)]


@router.get("/creator/trips/{trip_id}", response_model=CreatorTripRead)
async def get_trip(
    trip_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    acting: Acting = Depends(acting_as),
):
    creator = acting.creator
    return trip_read(await trips.owned(session, trip_id, creator.id))


@router.patch("/creator/trips/{trip_id}", response_model=CreatorTripRead)
async def update_trip(
    trip_id: uuid.UUID,
    data: CreatorTripUpdate,
    session: AsyncSession = Depends(get_session),
    acting: Acting = Depends(acting_as),
):
    creator = acting.creator
    trip = await trips.owned(session, trip_id, creator.id)
    if data.title is not None:
        trip.title = data.title.strip() or trip.title
    if data.summary is not None:
        trip.summary = data.summary.strip()
    if data.items is not None:
        trip.items = trips.clean_items([i.model_dump() for i in data.items])
    if data.cover_image_key is not None:
        await trips.set_cover(session, trip, data.cover_image_key)
    if data.publish:
        await trips.publish(session, trip)
    await session.commit()
    await session.refresh(trip)
    return trip_read(trip)


@router.get("/creator/trips/{trip_id}/cover-options", response_model=list[CoverOption])
async def trip_cover_options(
    trip_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    acting: Acting = Depends(acting_as),
):
    """Frames from the creator's video (and the reel's cover, and their own uploads) to choose
    the trip's cover image from."""
    creator = acting.creator
    trip = await trips.owned(session, trip_id, creator.id)
    return await trips.cover_options(session, trip)


@router.post("/creator/trips/{trip_id}/cover", response_model=CreatorTripRead)
async def upload_trip_cover(
    trip_id: uuid.UUID,
    data: CoverUpload,
    session: AsyncSession = Depends(get_session),
    acting: Acting = Depends(acting_as),
):
    """Use an image the creator uploads as the trip's cover (for reels read before frames were
    kept, or when none of the frames suit)."""
    creator = acting.creator
    trip = await trips.owned(session, trip_id, creator.id)
    trip.cover_image_key = trips.save_cover_upload(trip, data.filename, data.data_base64)
    await session.commit()
    await session.refresh(trip)
    return trip_read(trip)


@router.post("/creator/trips/from-reel", response_model=CreatorTripRead, status_code=201)
async def save_from_reel(
    data: SaveFromReel,
    session: AsyncSession = Depends(get_session),
    acting: Acting = Depends(acting_as),
):
    """Save a creator's reel-based trip and publish its affiliate link in one step."""
    creator = _active(acting)
    job = await session.get(ReelImport, data.import_id)
    if not job or job.user_id != acting.user.id:
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


# A reel is read in a minute or two. Past this, the worker has died or lost the job: say so,
# rather than leave the creator watching a spinner.
READING_GIVES_UP_AFTER = timedelta(minutes=15)


def _sources(link: CreatorLink) -> list[str]:
    """The reel and the video this link can be read from, best first: Instagram, then YouTube."""
    video = service.youtube_video_id(link.youtube_url)
    return [
        code
        for code in (
            link.instagram_shortcode,
            reels.youtube_shortcode(video) if video else None,
        )
        if code
    ]


async def _read_from(session: AsyncSession, link: CreatorLink) -> str | None:
    """What this link's itinerary is, or should be, read from: the source it was already built
    from if the link still has it, else the best one it has now."""
    sources = _sources(link)
    job = await session.get(ReelImport, link.import_id) if link.import_id else None
    # A video the creator uploaded stays the source until they replace it: it has no link to
    # check it against, and the file itself is gone once it has been read.
    if job is not None and (job.shortcode in sources or job.shortcode.startswith("upload-")):
        return job.shortcode
    return sources[0] if sources else None


def _gave_up(job: ReelImport) -> bool:
    return (
        job.status in (ImportStatus.QUEUED, ImportStatus.RUNNING)
        and datetime.now(UTC) - job.created_at > READING_GIVES_UP_AFTER
    )


def _link_status(link: CreatorLink, job: ReelImport | None, trip: CreatorTrip | None) -> str:
    if not link.instagram_url and not link.youtube_url and job is None:
        return "waiting"
    if job is None or (job.status == ImportStatus.DONE and trip is None):
        return "unread"
    if job.status == ImportStatus.FAILED or _gave_up(job):
        return "failed"
    if job.status != ImportStatus.DONE:
        return "building"
    return "published" if trip and trip.status == TripStatus.PUBLISHED else "ready"


async def _link_job_trip(
    session: AsyncSession, links: list[CreatorLink]
) -> tuple[dict[uuid.UUID, ReelImport], dict[uuid.UUID, CreatorTrip]]:
    """The import and the draft itinerary behind each link."""
    jobs = {
        j.id: j
        for j in await session.scalars(
            select(ReelImport).where(
                ReelImport.id.in_([link.import_id for link in links if link.import_id])
            )
        )
    }
    trip_ids = [j.creator_trip_id for j in jobs.values() if j.creator_trip_id]
    found = {
        t.id: t
        for t in await session.scalars(select(CreatorTrip).where(CreatorTrip.id.in_(trip_ids)))
    }
    return jobs, found


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
    jobs, found = await _link_job_trip(session, links)
    out = []
    for link in links:
        job = jobs.get(link.import_id) if link.import_id else None
        trip = found.get(job.creator_trip_id) if job and job.creator_trip_id else None
        state = _link_status(link, job, trip)
        out.append(
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
                youtube_url=link.youtube_url,
                auto_publish=link.auto_publish,
                status=state,
                step=job.step.value if job and state == "building" else None,
                error=(
                    (job.error or "This took too long. Try again.")
                    if job and state == "failed"
                    else ""
                ),
                trip_id=trip.id if trip else None,
                share_code=trip.share_code if trip and state == "published" else None,
                cover_image_url=trips.cover_url(trip) if trip else None,
                created_at=link.created_at,
                stats=LinkStats(**stats[link.id]),
            )
        )
    return out


async def _own_link(session: AsyncSession, creator: Creator, link_id: uuid.UUID) -> CreatorLink:
    link = await session.get(CreatorLink, link_id)
    if not link or link.creator_id != creator.id:
        raise not_found("Link")
    return link


@router.get("/creator/links", response_model=list[CreatorLinkRead])
async def my_links(
    session: AsyncSession = Depends(get_session), acting: Acting = Depends(acting_as)
):
    """The creator's reel links with each one's own numbers, newest first."""
    creator = acting.creator
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
    acting: Acting = Depends(acting_as),
):
    """Make a short link for a reel you are about to post. The Instagram URL comes later."""
    creator = _active(acting)
    link = await service.create_link(session, creator, data.label, data.destination_id)
    await session.commit()
    await session.refresh(link)
    return (await _link_read(session, [link]))[0]


@router.patch("/creator/links/{link_id}", response_model=CreatorLinkRead)
async def change_my_link(
    link_id: uuid.UUID,
    data: CreatorLinkUpdate,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    acting: Acting = Depends(acting_as),
):
    """Add the reel's Instagram or YouTube link once it is posted (it is read into an itinerary,
    Instagram first), choose auto-publishing, or publish / unpublish the itinerary."""
    creator = _active(acting)
    link = await _own_link(session, creator, link_id)
    sent = data.model_dump(exclude_unset=True)
    before = await _read_from(session, link)
    await service.update_link(
        session,
        link,
        label=data.label,
        instagram_url=(data.instagram_url or None) if "instagram_url" in sent else None,
        clear_instagram="instagram_url" in sent and not (data.instagram_url or "").strip(),
        youtube_url=data.youtube_url if "youtube_url" in sent else None,
        auto_publish=data.auto_publish,
    )
    after = await _read_from(session, link)
    reel_changed = after != before
    if reel_changed:
        await _retire_trip(session, link)  # the old reel's itinerary must not stay public
        link.import_id = None
    if data.published is not None and not reel_changed:
        trip = await _link_trip(session, link)
        if trip is None:
            raise bad_request("There's no itinerary to publish yet.")
        if data.published:
            await trips.publish(session, trip)
        else:
            trip.status = TripStatus.DRAFT
    if reel_changed and after:
        await _start_import(session, ai, acting.user, after, link)
    await session.commit()
    await session.refresh(link)
    return (await _link_read(session, [link]))[0]


@router.post("/creator/links/{link_id}/build", response_model=CreatorLinkRead)
async def build_my_link(
    link_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    acting: Acting = Depends(acting_as),
):
    """Read the link's reel or video into an itinerary again (after a failure, or for a link made
    before itineraries existed)."""
    creator = _active(acting)
    link = await _own_link(session, creator, link_id)
    sources = _sources(link)
    if not sources:
        raise bad_request(
            "Add your Instagram reel or YouTube video link first, or upload the video."
        )
    await _retire_trip(session, link)
    await _start_import(session, ai, acting.user, sources[0], link)
    await session.refresh(link)
    return (await _link_read(session, [link]))[0]


@router.post("/creator/links/{link_id}/upload", response_model=CreatorLinkRead)
async def upload_my_link_video(
    link_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    acting: Acting = Depends(acting_as),
):
    """Build the itinerary from a video file the creator uploads, for when a link can't be read
    (YouTube often refuses a server). The raw video is the request body (content-type video/*,
    filename in X-Reel-Filename), so it streams through the website's proxy without a multipart
    hop."""
    creator = _active(acting)
    link = await _own_link(session, creator, link_id)
    if not (request.headers.get("content-type") or "").startswith("video/"):
        raise bad_request("Upload a video file (mp4 or mov).")
    if await reels.recent_count(session, acting.user.id) >= settings.reel_imports_per_hour:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "That's a lot of reels. Try later.")
    data = await request.body()
    if not data:
        raise bad_request("That file is empty.")
    if len(data) > settings.reel_upload_max_mb * 1024 * 1024:
        raise bad_request(
            f"That video is over {settings.reel_upload_max_mb} MB. Try a shorter clip."
        )
    key = storage.save(data, request.headers.get("x-reel-filename") or "upload.mp4", "reel-uploads")
    await _retire_trip(session, link)
    await _start_import(session, ai, acting.user, reels.upload_shortcode(), link, upload_key=key)
    await session.refresh(link)
    return (await _link_read(session, [link]))[0]


async def _retire_trip(session: AsyncSession, link: CreatorLink) -> None:
    """Take down the itinerary built from the reel this link is leaving behind."""
    trip = await _link_trip(session, link)
    if trip is not None and trip.status == TripStatus.PUBLISHED:
        trip.status = TripStatus.DRAFT


async def _link_trip(session: AsyncSession, link: CreatorLink) -> CreatorTrip | None:
    """The itinerary built from this link's reel, if there is one."""
    job = await session.get(ReelImport, link.import_id) if link.import_id else None
    if job is None or job.creator_trip_id is None:
        return None
    return await session.get(CreatorTrip, job.creator_trip_id)


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
    trip = await _link_trip(session, link)
    return LinkVisit(
        referral_code=creator.referral_code,
        link_code=link.code,
        destination_id=link.destination_id,
        trip_share_code=trip.share_code if trip and trip.status == TripStatus.PUBLISHED else None,
    )
