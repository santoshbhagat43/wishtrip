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
    chat_session_id: uuid.UUID | None = None
    creator_trip_id: uuid.UUID | None
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


class DownloadRequestRead(BaseModel):
    """One download attempt, for staff: which tool, whether it worked, and what it cost."""

    id: uuid.UUID
    created_at: datetime
    import_id: uuid.UUID | None
    provider: str
    platform: str
    source_url: str
    ok: bool
    error_code: str
    error_message: str
    duration_ms: int
    bytes: int | None
    credits_spent: float | None
    credits_remaining: float | None


class ProviderTotals(BaseModel):
    provider: str
    attempts: int
    failures: int
    credits_spent: float


class DownloadLog(BaseModel):
    """The latest attempts, and the totals over all of them."""

    totals: list[ProviderTotals]
    credits_remaining: float | None
    requests: list[DownloadRequestRead]


class ImportStage(BaseModel):
    step: str
    seconds: float


class ImportLogEntry(BaseModel):
    at: datetime
    step: str | None = None
    message: str = ""
    seconds: float | None = None


class ImportRow(BaseModel):
    """One reel import, for staff: where it stands and how long each stage took."""

    id: uuid.UUID
    url: str
    shortcode: str
    kind: str
    status: ImportStatus
    step: ImportStep
    error: str
    created_at: datetime
    finished_at: datetime | None
    requested_by: str
    creator_handle: str
    destination_name: str
    places: int
    queue_seconds: float | None
    stages: list[ImportStage]
    total_seconds: float | None


class ImportTotals(BaseModel):
    total: int
    done: int
    failed: int
    running: int
    average_seconds: float | None


class ImportList(BaseModel):
    totals: ImportTotals
    items: list[ImportRow]
    # How many imports match the search and filter (the totals above cover all of them).
    total: int
    page: int
    page_size: int


class ImportItinerary(BaseModel):
    """A trip built from this reel's places (by a traveller, or by staff to check the reel)."""

    code: str
    days: int
    adults: int
    kids: int
    seniors: int
    group: str
    origin_city: str
    build_status: str
    build_error: str
    ai_built: bool
    created_at: datetime
    items: list[dict]


class ImportDetail(ImportRow):
    caption: str
    duration_seconds: float | None
    ocr_lines: list[dict]
    transcript: str
    transcript_language: str
    transcript_en: str
    extracted: dict
    place_list: list[dict]
    itineraries: list[ImportItinerary] = []
    log: list[ImportLogEntry]
    downloads: list[DownloadRequestRead]
