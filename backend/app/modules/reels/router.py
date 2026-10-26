import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.config import settings
from app.core.deps import get_current_user, require_roles
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.creators.models import Creator
from app.modules.media.storage import storage
from app.modules.reels import service
from app.modules.reels.models import CreatorContent, DownloadRequest, ImportStatus, ReelImport
from app.modules.reels.schemas import (
    DownloadLog,
    DownloadRequestRead,
    ImportDetail,
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
    if await service.recent_count(session, user.id) >= settings.reel_imports_per_hour:
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


@router.get("/admin/imports", response_model=ImportList)
async def admin_imports(
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_roles(Role.ADMIN, Role.EDITOR)),
):
    """Every reel import, newest first, with its stage and how long each stage took."""
    jobs = (
        await session.scalars(
            select(ReelImport).order_by(ReelImport.created_at.desc()).limit(min(limit, 300))
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
    finished = [r.total_seconds for r in rows if r.status == ImportStatus.DONE and r.stages]
    return ImportList(
        totals=ImportTotals(
            total=sum(by_status.values()),
            done=by_status.get(ImportStatus.DONE, 0),
            failed=by_status.get(ImportStatus.FAILED, 0),
            running=by_status.get(ImportStatus.RUNNING, 0) + by_status.get(ImportStatus.QUEUED, 0),
            average_seconds=round(sum(finished) / len(finished), 1) if finished else None,
        ),
        items=rows,
    )


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
    return ImportDetail(
        **await _row(session, job),
        caption=content.caption if content else "",
        duration_seconds=content.duration_seconds if content else None,
        ocr_lines=content.ocr_lines if content else [],
        transcript=content.transcript if content else "",
        transcript_language=content.transcript_language if content else "",
        transcript_en=content.transcript_en if content else "",
        extracted=content.extracted if content else {},
        place_list=content.places if content else [],
        log=[ImportLogEntry(**e) for e in job.log or []],
        downloads=[DownloadRequestRead.model_validate(d, from_attributes=True) for d in downloads],
    )
