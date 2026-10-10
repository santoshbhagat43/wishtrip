import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKey, str_enum


class MediaKind(enum.StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    INFLUENCER = "influencer"


class Media(UUIDPrimaryKey, Base):
    __tablename__ = "media"

    location_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[MediaKind] = mapped_column(str_enum(MediaKind))
    # Either an uploaded file (storage_key) or an external link (external_url).
    storage_key: Mapped[str | None] = mapped_column(String(500))
    external_url: Mapped[str | None] = mapped_column(String(1000))
    content_type: Mapped[str] = mapped_column(String(100), default="")
    caption: Mapped[str] = mapped_column(String(500), default="")
    author: Mapped[str] = mapped_column(String(255), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
