from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKey


class TripJackLog(UUIDPrimaryKey, Base):
    """One call to TripJack, as sent and as answered: what we are calling and what we get back.
    The API key is masked and personal details in a request are redacted. Large answers are cut
    (`response_truncated`); the catalogue sync keeps only a short head of each answer. Rows older
    than TRIPJACK_LOG_DAYS are deleted as new ones arrive."""

    __tablename__ = "tripjack_logs"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    product: Mapped[str] = mapped_column(String(16), index=True)  # hotels | flights | insurance
    method: Mapped[str] = mapped_column(String(8))
    url: Mapped[str] = mapped_column(String(500))
    path: Mapped[str] = mapped_column(String(300), index=True)
    request_headers: Mapped[dict] = mapped_column(JSONB, default=dict)
    request_body: Mapped[dict | list | None] = mapped_column(JSONB)
    request_params: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[int | None] = mapped_column(Integer, index=True)
    response_headers: Mapped[dict] = mapped_column(JSONB, default=dict)
    # The answer as TripJack sent it (text), possibly cut short.
    response_body: Mapped[str] = mapped_column(Text, default="")
    response_bytes: Mapped[int] = mapped_column(Integer, default=0)
    response_truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    # When the answer was cut: all of it, gzip-compressed (read only when asked for).
    response_full: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    ms: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    ok: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    error: Mapped[str] = mapped_column(String(400), default="")
    # The request that made this call (`supplier.trace_id` in our own responses).
    trace_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    environment: Mapped[str] = mapped_column(String(48), default="")
