import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.reels.models import ImportStatus, ImportStep


class ReelImportCreate(BaseModel):
    url: str = Field(min_length=1, max_length=1000)


class ReelPlace(BaseModel):
    name: str
    kind: str
    evidence: str
    source: str
    t: float | None = None
    verified: bool
    location_id: uuid.UUID | None = None
    location_name: str | None = None
    location_type: str | None = None


class ReelContentRead(BaseModel):
    shortcode: str
    url: str
    creator_handle: str
    creator_name: str
    caption: str
    thumbnail_url: str | None
    destination_name: str
    summary: str
    days_hint: int | None
    places: list[ReelPlace]
    tips: list[str]
    has_voice: bool
    screen_lines: int


class ReelImportRead(BaseModel):
    id: uuid.UUID
    url: str
    status: ImportStatus
    step: ImportStep
    error: str
    created_at: datetime
    finished_at: datetime | None
    chat_session_id: uuid.UUID | None
    # The message that starts planning in chat; set when the import is done.
    seed_message: str | None = None
    content: ReelContentRead | None = None


class ReelContentDetail(ReelContentRead):
    """Staff view: everything we read off the reel."""

    id: uuid.UUID
    created_at: datetime
    ocr_lines: list[dict]
    transcript: str
    transcript_language: str
    transcript_en: str
