import enum
import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class MessageRole(enum.StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class Grounding(enum.StrEnum):
    KNOWLEDGE_BASE = "knowledge_base"
    PARTIAL = "partial"
    GENERAL = "general"


class ChatSession(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "chat_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="New trip")
    # Trip context accumulated across turns (destination, days, companions, ...).
    state: Mapped[dict] = mapped_column(JSONB, default=dict)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", order_by="ChatMessage.created_at", cascade="all, delete-orphan"
    )


class ChatMessage(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "chat_messages"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MessageRole] = mapped_column(str_enum(MessageRole))
    content: Mapped[str] = mapped_column(Text)
    intent: Mapped[dict | None] = mapped_column(JSONB)
    grounding: Mapped[Grounding | None] = mapped_column(str_enum(Grounding))
    suggestions: Mapped[list] = mapped_column(JSONB, default=list)
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    follow_ups: Mapped[list] = mapped_column(JSONB, default=list)
    validation_notes: Mapped[list] = mapped_column(JSONB, default=list)
    # Scheduled day plan (start times, travel) and the feasibility report that produced it.
    itinerary: Mapped[list] = mapped_column(JSONB, default=list)
    feasibility: Mapped[dict | None] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(100), default="")
    # What the model was given (KB context, merged trip state) — visible to staff for debugging.
    debug: Mapped[dict] = mapped_column(JSONB, default=dict)

    session: Mapped[ChatSession] = relationship(back_populates="messages")
