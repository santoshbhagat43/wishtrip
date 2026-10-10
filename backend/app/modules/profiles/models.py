import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, SmallInteger, String, Uuid, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class Companions(enum.StrEnum):
    SOLO = "solo"
    COUPLE = "couple"
    FAMILY = "family"  # with children
    FRIENDS = "friends"
    SENIORS = "seniors"  # e.g. travelling with elderly parents


class EventType(enum.StrEnum):
    VIEWED = "viewed"
    SELECTED = "selected"
    ADDED = "added"
    BOOKED = "booked"
    SKIPPED = "skipped"
    REMOVED = "removed"


class TravelerProfile(Timestamps, Base):
    """What a traveler has told us explicitly. Behavior lives in ProfileEvent."""

    __tablename__ = "traveler_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    budget_level: Mapped[int | None] = mapped_column(SmallInteger)
    energy_level: Mapped[int | None] = mapped_column(SmallInteger)
    companions: Mapped[Companions | None] = mapped_column(str_enum(Companions))
    travel_styles: Mapped[list[str]] = mapped_column(ARRAY(String(32)), default=list)
    food_preferences: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list)
    preferred_times: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list)
    interest_tag_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(Uuid), default=list)
    accommodation_preference: Mapped[str] = mapped_column(String(64), default="")
    accessibility_needs: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(String(1000), default="")


class ProfileEvent(UUIDPrimaryKey, Base):
    __tablename__ = "profile_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[EventType] = mapped_column(str_enum(EventType))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
