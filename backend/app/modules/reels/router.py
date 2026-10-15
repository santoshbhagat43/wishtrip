import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.config import settings
from app.core.deps import get_current_user
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.creators.models import Creator
from app.modules.media.storage import storage
from app.modules.reels import service
from app.modules.reels.models import CreatorContent, ReelImport
from app.modules.reels.schemas import (
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
        raise bad_request("Paste an Instagram reel link, like instagram.com/reel/…")
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
