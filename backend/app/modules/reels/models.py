import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class CreatorContent(UUIDPrimaryKey, Timestamps, Base):
    """A processed reel. Cached by shortcode: the same reel is downloaded and read once."""

    __tablename__ = "creator_content"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("creators.id", ondelete="CASCADE"), index=True
    )
    platform: Mapped[str] = mapped_column(String(32), default="instagram")
    shortcode: Mapped[str] = mapped_column(String(64), unique=True)
    url: Mapped[str] = mapped_column(String(1000))
    caption: Mapped[str] = mapped_column(Text, default="")
    location_tag: Mapped[str] = mapped_column(String(255), default="")
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    # Only the cover image is kept; the video, audio and frames are deleted after reading.
    thumbnail_key: Mapped[str | None] = mapped_column(String(500))
    # [{"t": seconds, "text": "..."}] — text read off the frames, first time each line appeared.
    ocr_lines: Mapped[list] = mapped_column(JSONB, default=list)
    transcript: Mapped[str] = mapped_column(Text, default="")
    transcript_language: Mapped[str] = mapped_column(String(32), default="")
    transcript_en: Mapped[str] = mapped_column(Text, default="")
    # The model's reading: destination, places (each with its evidence), tips.
    extracted: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Places matched against the knowledge base: verified ones carry a location_id.
    places: Mapped[list] = mapped_column(JSONB, default=list)
    destination_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL")
    )
    destination_name: Mapped[str] = mapped_column(String(255), default="")


class ImportKind(enum.StrEnum):
    # A traveller pasting a reel -> a seeded chat session.
    CHAT = "chat"
    # A creator importing their own reel -> an editable trip they own.
    CREATOR_TRIP = "creator_trip"


class ImportStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class ImportStep(enum.StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    READING_SCREEN = "reading_screen"
    LISTENING = "listening"
    FINDING_PLACES = "finding_places"
    DONE = "done"


class ReelImport(UUIDPrimaryKey, Timestamps, Base):
    """One traveller pasting one reel link: the job, and where it led (a chat session)."""

    __tablename__ = "reel_imports"

    url: Mapped[str] = mapped_column(String(1000))
    shortcode: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    content_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creator_content.id", ondelete="SET NULL")
    )
    chat_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="SET NULL")
    )
    kind: Mapped[ImportKind] = mapped_column(str_enum(ImportKind), default=ImportKind.CHAT)
    creator_trip_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creator_trips.id", ondelete="SET NULL")
    )
    status: Mapped[ImportStatus] = mapped_column(
        str_enum(ImportStatus), default=ImportStatus.QUEUED
    )
    step: Mapped[ImportStep] = mapped_column(str_enum(ImportStep), default=ImportStep.QUEUED)
    error: Mapped[str] = mapped_column(Text, default="")
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
