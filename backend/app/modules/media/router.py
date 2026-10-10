import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, computed_field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import require_staff
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.audit.service import record
from app.modules.knowledge import service as knowledge
from app.modules.media.models import Media, MediaKind
from app.modules.media.storage import storage
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["media"])


class MediaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    location_id: uuid.UUID
    kind: MediaKind
    storage_key: str | None
    external_url: str | None
    content_type: str
    caption: str
    author: str
    created_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def url(self) -> str:
        return storage.url(self.storage_key) if self.storage_key else (self.external_url or "")


@router.get("/locations/{location_id}/media", response_model=list[MediaRead])
async def list_media(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    rows = await session.scalars(
        select(Media)
        .where(Media.location_id == location_id)
        .order_by(Media.sort_order, Media.created_at)
    )
    return list(rows)


@router.post("/locations/{location_id}/media", response_model=MediaRead, status_code=201)
async def add_media(
    location_id: uuid.UUID,
    kind: MediaKind = Form(...),
    caption: str = Form(""),
    author: str = Form(""),
    external_url: str | None = Form(None),
    file: UploadFile | None = File(None),
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    await knowledge.get(session, location_id)
    if not file and not external_url:
        raise bad_request("Upload a file or provide an external URL")
    media = Media(
        location_id=location_id,
        kind=kind,
        caption=caption,
        author=author,
        external_url=external_url or None,
    )
    if file:
        content_type = file.content_type or ""
        if not content_type.startswith(("image/", "video/")):
            raise bad_request("Only image and video files are allowed")
        data = await file.read()
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")
        media.storage_key = storage.save(
            data, file.filename or "upload", f"locations/{location_id}"
        )
        media.content_type = content_type
    session.add(media)
    await session.flush()
    await record(
        session, actor, "create", "media", media.id, {"location_id": location_id, "kind": kind}
    )
    await session.commit()
    return media


@router.delete("/media/{media_id}", status_code=204)
async def delete_media(
    media_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    media = await session.get(Media, media_id)
    if not media:
        raise not_found("Media")
    if media.storage_key:
        storage.delete(media.storage_key)
    await session.delete(media)
    await record(session, actor, "delete", "media", media_id)
    await session.commit()
    return Response(status_code=204)
