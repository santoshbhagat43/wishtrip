import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.ai.scheduling import schedule_embedding
from app.core.config import settings
from app.core.deps import get_current_user, require_roles
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.audit.service import record
from app.modules.creators import builder, mine
from app.modules.creators.models import Creator, TravellerTrip
from app.modules.media.storage import storage
from app.modules.reels import publish, service
from app.modules.reels.models import CreatorContent, DownloadRequest, ImportStatus, ReelImport
from app.modules.reels.schemas import (
    DownloadLog,
    DownloadRequestRead,
    ImportDetail,
    ImportItinerary,
    ImportList,
    ImportLogEntry,
    ImportRow,
    ImportStage,
    ImportTotals,
    ProviderTotals,
    ReelContentDetail,
    ReelContentRead,
    ReelImportCreate,
    ReelImportRead,
)
from app.modules.users.models import Role, User

router = APIRouter(prefix="/reels", tags=["reels"])


def content_read(content: CreatorContent, creator: Creator | None) -> dict:
    extracted = content.extracted or {}
    return {
        "shortcode": content.shortcode,
        "url": content.url,
        "creator_handle": creator.handle if creator else "",
        "creator_name": creator.display_name if creator else "",
        "caption": content.caption,
        "thumbnail_url": storage.url(content.thumbnail_key) if content.thumbnail_key else None,
        "destination_name": content.destination_name,
        "summary": extracted.get("summary", ""),
        "days_hint": extracted.get("days_hint"),
        "places": content.places,
        "tips": extracted.get("tips", []),
        "has_voice": bool(content.transcript),
        "screen_lines": len(content.ocr_lines or []),
    }


async def import_read(session: AsyncSession, job: ReelImport) -> ReelImportRead:
    data = ReelImportRead.model_validate(job, from_attributes=True)
    if job.content_id:
        content = await session.get(CreatorContent, job.content_id)
        if content:
            creator = await session.get(Creator, content.creator_id) if content.creator_id else None
            data.content = ReelContentRead(**content_read(content, creator))
            data.seed_message = service.seed_message(content, creator.handle if creator else "")
    return data


def enqueue(job_id: uuid.UUID) -> None:
    from app.workers.tasks import process_reel_task

    process_reel_task.delay(str(job_id))


@router.post("/imports", response_model=ReelImportRead, status_code=201)
async def start_import(
    data: ReelImportCreate,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    user: User = Depends(get_current_user),
):
    shortcode = service.shortcode_from(data.url)
    if not shortcode:
        raise bad_request(
            "Paste an Instagram reel or YouTube video link, "
            "like instagram.com/reel/… or youtube.com/shorts/…"
        )
    if await service.recent_count(session, user.id) >= settings.reel_imports_per_hour:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "That's a lot of reels. Try again in an hour."
        )
    job = ReelImport(url=service.canonical_url(shortcode), shortcode=shortcode, user_id=user.id)
    session.add(job)
    await session.commit()
    content = await service.cached(session, shortcode)
    if content:
        await service.finish(session, job, content)  # read before: no download needed
    elif settings.reels_inline:
        await service.process(session, ai, job)
    else:
        enqueue(job.id)
    await session.refresh(job)
    return await import_read(session, job)


@router.post("/uploads", response_model=ReelImportRead, status_code=201)
async def upload_video(
    request: Request,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    user: User = Depends(get_current_user),
):
    """Build a trip from a video the traveller uploads from their device.

    The raw video is the request body (content-type video/*, filename in X-Reel-Filename),
    so it streams straight through the website's proxy without a multipart hop.
    """
    if not (request.headers.get("content-type") or "").startswith("video/"):
        raise bad_request("Upload a video file (mp4 or mov).")
    # Staff testing videos from the dashboard are not held to the traveller's hourly limit.
    staff = user.role in (Role.ADMIN, Role.EDITOR)
    if not staff and await service.recent_count(session, user.id) >= settings.reel_imports_per_hour:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "That's a lot of reels. Try again in an hour."
        )
    data = await request.body()
    if len(data) > settings.reel_upload_max_mb * 1024 * 1024:
        raise bad_request(
            f"That video is over {settings.reel_upload_max_mb} MB. Try a shorter clip."
        )
    if not data:
        raise bad_request("That file is empty.")
    filename = request.headers.get("x-reel-filename") or "upload.mp4"
    key = storage.save(data, filename, "reel-uploads")
    job = ReelImport(url="", shortcode=service.upload_shortcode(), upload_key=key, user_id=user.id)
    session.add(job)
    await session.commit()
    if settings.reels_inline:
        await service.process(session, ai, job)
    else:
        enqueue(job.id)
    await session.refresh(job)
    return await import_read(session, job)


@router.get("/imports/{import_id}", response_model=ReelImportRead)
async def get_import(
    import_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    job = await session.get(ReelImport, import_id)
    if not job or (job.user_id != user.id and user.role == Role.TRAVELER):
        raise not_found("Reel import")
    return await import_read(session, job)


@router.get("/content/{shortcode}", response_model=ReelContentDetail)
async def get_content(
    shortcode: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role == Role.TRAVELER:
        raise not_found("Reel")
    content = await session.scalar(
        select(CreatorContent).where(CreatorContent.shortcode == shortcode)
    )
    creator = await session.get(Creator, content.creator_id) if content else None
    if not content or not creator:
        raise not_found("Reel")
    return ReelContentDetail(
        **content_read(content, creator),
        id=content.id,
        created_at=content.created_at,
        ocr_lines=content.ocr_lines,
        transcript=content.transcript,
        transcript_language=content.transcript_language,
        transcript_en=content.transcript_en,
    )


@router.get("/downloads", response_model=DownloadLog)
async def download_log(
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_roles(Role.ADMIN)),
):
    """Every try at downloading a reel or video, newest first: which tool, whether it worked and,
    for the paid SaveAPI fallback, what it cost and what is left."""
    rows = await session.scalars(
        select(DownloadRequest).order_by(DownloadRequest.created_at.desc()).limit(min(limit, 200))
    )
    totals = await session.execute(
        select(
            DownloadRequest.provider,
            func.count(),
            func.count(case((DownloadRequest.ok.is_(False), 1))),
            func.coalesce(func.sum(DownloadRequest.credits_spent), 0.0),
        ).group_by(DownloadRequest.provider)
    )
    latest = await session.scalar(
        select(DownloadRequest.credits_remaining)
        .where(DownloadRequest.credits_remaining.is_not(None))
        .order_by(DownloadRequest.created_at.desc())
        .limit(1)
    )
    return DownloadLog(
        totals=[
            ProviderTotals(provider=p, attempts=n, failures=f, credits_spent=float(c))
            for p, n, f, c in totals.all()
        ],
        credits_remaining=latest,
        requests=[DownloadRequestRead.model_validate(r, from_attributes=True) for r in rows],
    )


def _stages(job: ReelImport) -> tuple[float | None, list[ImportStage]]:
    """Seconds waiting in the queue, then seconds spent in each stage, read off the job's log."""
    log = job.log or []
    marks = [(datetime.fromisoformat(e["at"]), e["step"]) for e in log if e.get("step")]
    started = next((at for at, step in marks if step == "started"), None)
    queue = (started - job.created_at).total_seconds() if started else None
    stages = [(at, step) for at, step in marks if step not in ("started", "failed")]
    end = job.finished_at or (datetime.now(UTC) if job.status == ImportStatus.RUNNING else None)
    out: list[ImportStage] = []
    for i, (at, step) in enumerate(stages):
        nxt = stages[i + 1][0] if i + 1 < len(stages) else end
        if nxt is not None:
            out.append(ImportStage(step=step, seconds=round((nxt - at).total_seconds(), 1)))
    return queue, out


async def _row(session: AsyncSession, job: ReelImport) -> dict:
    content = await session.get(CreatorContent, job.content_id) if job.content_id else None
    creator = (
        await session.get(Creator, content.creator_id) if content and content.creator_id else None
    )
    user = await session.get(User, job.user_id)
    queue, stages = _stages(job)
    end = job.finished_at or datetime.now(UTC)
    return {
        "id": job.id,
        "url": job.url,
        "shortcode": job.shortcode,
        "kind": job.kind.value,
        "status": job.status,
        "step": job.step,
        "error": job.error,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
        "requested_by": user.email if user else "",
        "creator_handle": creator.handle if creator and creator.handle else "",
        "destination_name": content.destination_name if content else "",
        "places": len([p for p in content.places if p.get("kind") != "area"]) if content else 0,
        "queue_seconds": round(queue, 1) if queue is not None else None,
        "stages": stages,
        "total_seconds": round((end - job.created_at).total_seconds(), 1),
    }


def _like(text: str) -> str:
    """A LIKE pattern that matches the text literally (a typed % or _ is not a wildcard)."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/admin/imports", response_model=ImportList)
async def admin_imports(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str | None = Query(
        None, description="Matches the link, shortcode, error, who asked, creator or destination"
    ),
    state: Literal["in_progress", "done", "failed"] | None = Query(
        None, alias="status", description="Only this state (in progress = queued or running)"
    ),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_roles(Role.ADMIN, Role.EDITOR)),
):
    """Reel imports, newest first, a page at a time, with each one's stage and how long each stage
    took. The totals always cover every import, not just the page or the search."""
    query = (
        select(ReelImport)
        .join(User, User.id == ReelImport.user_id)
        .outerjoin(CreatorContent, CreatorContent.id == ReelImport.content_id)
        .outerjoin(Creator, Creator.id == CreatorContent.creator_id)
    )
    if state == "in_progress":
        query = query.where(ReelImport.status.in_((ImportStatus.QUEUED, ImportStatus.RUNNING)))
    elif state:
        query = query.where(ReelImport.status == ImportStatus(state))
    if q and q.strip():
        like = _like(q.strip())
        query = query.where(
            or_(
                *(
                    column.ilike(like, escape="\\")
                    for column in (
                        ReelImport.url,
                        ReelImport.shortcode,
                        ReelImport.error,
                        User.email,
                        Creator.handle,
                        CreatorContent.destination_name,
                    )
                )
            )
        )
    matching = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    jobs = (
        await session.scalars(
            query.order_by(ReelImport.created_at.desc(), ReelImport.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    rows = [ImportRow(**await _row(session, j)) for j in jobs]
    by_status = dict(
        (
            await session.execute(
                select(ReelImport.status, func.count()).group_by(ReelImport.status)
            )
        ).all()
    )
    average = await session.scalar(
        select(
            func.avg(func.extract("epoch", ReelImport.finished_at - ReelImport.created_at))
        ).where(ReelImport.status == ImportStatus.DONE, ReelImport.finished_at.is_not(None))
    )
    return ImportList(
        totals=ImportTotals(
            total=sum(by_status.values()),
            done=by_status.get(ImportStatus.DONE, 0),
            failed=by_status.get(ImportStatus.FAILED, 0),
            running=by_status.get(ImportStatus.RUNNING, 0) + by_status.get(ImportStatus.QUEUED, 0),
            average_seconds=round(float(average), 1) if average is not None else None,
        ),
        items=rows,
        total=matching,
        page=page,
        page_size=page_size,
    )


class SampleTrip(BaseModel):
    # Empty: the days the video says (up to the most a trip can have), else 4.
    days: int | None = Field(None, ge=1, le=builder.MAX_DAYS)


@router.post("/admin/imports/{import_id}/itinerary", status_code=status.HTTP_202_ACCEPTED)
async def build_sample_itinerary(
    import_id: uuid.UUID,
    body: SampleTrip,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_roles(Role.ADMIN, Role.EDITOR)),
):
    """Build the itinerary a couple from Bengaluru would get from this reel, to check the reel
    reads into a good trip. It builds in the background; the import shows it when it is ready."""
    job = await session.get(ReelImport, import_id)
    if not job:
        raise not_found("Reel import")
    content = await session.get(CreatorContent, job.content_id) if job.content_id else None
    if job.status != ImportStatus.DONE or content is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That reel has not been read yet.")
    said = (content.extracted or {}).get("days_hint")
    days = body.days or (min(said, builder.MAX_DAYS) if isinstance(said, int) and said > 0 else 4)
    config = mine.MineConfig(
        adults=2, group="couple", days=days, pace="relaxed", origin="BLR", origin_city="Bengaluru"
    )
    trip = await mine.trip_from_import(session, job, content, config)
    return {"code": trip.code, "days": trip.days}


@router.post("/admin/imports/{import_id}/places")
async def add_places_to_ours(
    import_id: uuid.UUID,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    actor: User = Depends(require_roles(Role.ADMIN, Role.EDITOR)),
):
    """Publish this reel's places that are not in our places yet (name, type and town only,
    marked as needing verification), then match the reel again."""
    job = await session.get(ReelImport, import_id)
    if not job:
        raise not_found("Reel import")
    content = await session.get(CreatorContent, job.content_id) if job.content_id else None
    if job.status != ImportStatus.DONE or content is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That reel has not been read yet.")
    result = await publish.add_to_places(session, ai, content)
    for row, location_id in zip(result["added"], result["ids"], strict=True):
        await record(session, actor, "create", "location", uuid.UUID(location_id),
                     {**row, "from_reel": content.shortcode})  # fmt: skip
    await session.commit()
    if result["ids"]:
        background.add_task(schedule_embedding, [uuid.UUID(i) for i in result["ids"]])
    return {"added": result["added"], "skipped": result["skipped"]}


@router.get("/admin/imports/{import_id}", response_model=ImportDetail)
async def admin_import(
    import_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_roles(Role.ADMIN, Role.EDITOR)),
):
    """One import in full: the stage timings and log, what was read off the screen and heard in the
    voice-over, the places found, and every download attempt."""
    job = await session.get(ReelImport, import_id)
    if not job:
        raise not_found("Reel import")
    content = await session.get(CreatorContent, job.content_id) if job.content_id else None
    downloads = await session.scalars(
        select(DownloadRequest)
        .where(DownloadRequest.import_id == job.id)
        .order_by(DownloadRequest.created_at)
    )
    trips = await session.scalars(
        select(TravellerTrip)
        .where(TravellerTrip.source_import_id == job.id)
        .order_by(TravellerTrip.created_at.desc())
        .limit(5)
    )
    return ImportDetail(
        **await _row(session, job),
        itineraries=[ImportItinerary.model_validate(t, from_attributes=True) for t in trips],
        caption=content.caption if content else "",
        duration_seconds=content.duration_seconds if content else None,
        ocr_lines=content.ocr_lines if content else [],
        transcript=content.transcript if content else "",
        transcript_language=content.transcript_language if content else "",
        transcript_en=content.transcript_en if content else "",
        transcript_segments=content.transcript_segments if content else [],
        extracted=content.extracted if content else {},
        place_list=content.places if content else [],
        log=[ImportLogEntry(**e) for e in job.log or []],
        downloads=[DownloadRequestRead.model_validate(d, from_attributes=True) for d in downloads],
    )
