import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
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


class CommissionType(enum.StrEnum):
    # How a creator earns on a booking made through their affiliate link.
    NONE = "none"  # nothing agreed yet
    PERCENT = "percent"  # a share of each booking (commission_value is basis points: 1000 = 10%)
    FLAT = "flat"  # a fixed amount per booking (commission_value is paise)


class Creator(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "creators"
    __table_args__ = (UniqueConstraint("platform", "handle"),)

    platform: Mapped[str] = mapped_column(String(32), default="instagram")
    # Null for a creator who signed up by email before we know their Instagram handle.
    handle: Mapped[str | None] = mapped_column(String(100), index=True)
    # Set for a creator who signed up on the website; staff fill in the handle later.
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    # WhatsApp number in international format (+919876543210), from the apply form. Lets a
    # creator sign in with a code sent on WhatsApp.
    whatsapp: Mapped[str | None] = mapped_column(String(20), unique=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")
    profile_url: Mapped[str] = mapped_column(String(500), default="")
    # The creator's YouTube channel (canonical https URL), alongside the Instagram handle above.
    # A creator may have either channel or both.
    youtube_url: Mapped[str | None] = mapped_column(String(300))
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
    # Booking commission, set by staff at approval. value = basis points (percent) or paise (flat).
    commission_type: Mapped[CommissionType] = mapped_column(
        str_enum(CommissionType), default=CommissionType.NONE
    )
    commission_value: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")


class CreatorLink(UUIDPrimaryKey, Timestamps, Base):
    """A short, trackable link a creator puts in one reel's caption or bio.

    Made before the reel exists, so the Instagram URL is empty at first ("waiting for your reel")
    and added once the reel is posted ("live"). Opening it credits the creator, exactly like their
    overall link, and keeps its own numbers so they can see which reel is working.
    """

    __tablename__ = "creator_links"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("creators.id", ondelete="CASCADE"), index=True
    )
    # The short code in wishtrip.../r/<code>.
    code: Mapped[str] = mapped_column(String(40), unique=True)
    label: Mapped[str] = mapped_column(String(120), default="")
    # Where a traveller lands: a destination page (a published city), or the home page if unset.
    destination_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL")
    )
    # Added by the creator once the reel is posted. Null = still waiting for the reel.
    instagram_url: Mapped[str | None] = mapped_column(String(500))
    instagram_shortcode: Mapped[str | None] = mapped_column(String(64))


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
    # The reel link this touch came through, when it came through one.
    link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creator_links.id", ondelete="SET NULL", name="fk_creator_attributions_link"),
        index=True,
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


class TripStatus(enum.StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"


class CreatorTrip(UUIDPrimaryKey, Timestamps, Base):
    """An itinerary a creator builds from their own reel, edits, and publishes as a shareable,
    affiliate-tagged link."""

    __tablename__ = "creator_trips"

    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("creators.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="")
    destination_name: Mapped[str] = mapped_column(String(255), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    cover_image_key: Mapped[str | None] = mapped_column(String(500))
    source_shortcode: Mapped[str | None] = mapped_column(String(64))
    # [{id, kind, name, note, day, location_id, verified}] — the editable stops.
    items: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[TripStatus] = mapped_column(str_enum(TripStatus), default=TripStatus.DRAFT)
    # Set when published: the public link is /t/<share_code>, carrying the creator's affiliate tag.
    share_code: Mapped[str | None] = mapped_column(String(64), unique=True)
