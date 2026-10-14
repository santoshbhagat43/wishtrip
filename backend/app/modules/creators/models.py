import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class CreatorStatus(enum.StrEnum):
    # Signed up on the website (email + OTP) and waiting for a staff member to approve them.
    PENDING = "pending"
    # Saved automatically from a reel a traveller pasted. We count who they bring in, but
    # owe nothing and never present them as a partner until they accept the affiliate terms.
    UNCLAIMED = "unclaimed"
    INVITED = "invited"
    ACTIVE = "active"
    PAUSED = "paused"


class Creator(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "creators"
    __table_args__ = (UniqueConstraint("platform", "handle"),)

    platform: Mapped[str] = mapped_column(String(32), default="instagram")
    # Null for a creator who signed up by email before we know their Instagram handle.
    handle: Mapped[str | None] = mapped_column(String(100), index=True)
    # Set for a creator who signed up on the website; staff fill in the handle later.
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")
    profile_url: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[CreatorStatus] = mapped_column(
        str_enum(CreatorStatus), default=CreatorStatus.UNCLAIMED
    )
    # The creator's own wishtrip account, once they claim the profile.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # Their link: wishtrip…/c/<referral_code>.
    referral_code: Mapped[str] = mapped_column(String(64), unique=True)
    commission_per_user_paise: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")


class AttributionSource(enum.StrEnum):
    REFERRAL_LINK = "referral_link"
    REEL = "reel"


class AttributionEvent(enum.StrEnum):
    VISIT = "visit"  # opened the creator's link (anonymous visitor)
    SIGNUP = "signup"  # signed up after opening the link
    REEL_IMPORT = "reel_import"  # pasted one of the creator's reels
    TRIP_PLANNED = "trip_planned"  # a credited traveller got their first trip plan
    BOOKING = "booking"  # later, once bookings exist


class CreatorAttribution(UUIDPrimaryKey, Base):
    """Every touch between a traveller and a creator; the commission trail."""

    __tablename__ = "creator_attributions"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("creators.id", ondelete="CASCADE"), index=True
    )
    content_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creator_content.id", ondelete="SET NULL")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    visitor_id: Mapped[str] = mapped_column(String(64), default="")
    source: Mapped[AttributionSource] = mapped_column(str_enum(AttributionSource))
    event: Mapped[AttributionEvent] = mapped_column(str_enum(AttributionEvent))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CommissionStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    PAID = "paid"
    VOID = "void"


class CommissionEntry(UUIDPrimaryKey, Timestamps, Base):
    """One earned commission: today one per credited traveller who planned a trip."""

    __tablename__ = "creator_commissions"
    __table_args__ = (UniqueConstraint("creator_id", "user_id", "event"),)

    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("creators.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event: Mapped[AttributionEvent] = mapped_column(str_enum(AttributionEvent))
    amount_paise: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[CommissionStatus] = mapped_column(
        str_enum(CommissionStatus), default=CommissionStatus.PENDING
    )
