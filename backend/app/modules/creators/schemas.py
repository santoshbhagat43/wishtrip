import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.creators.models import (
    AttributionEvent,
    AttributionSource,
    CommissionStatus,
    CommissionType,
    CreatorStatus,
    TripStatus,
)


class CreatorApplication(BaseModel):
    """The apply form. A creator gives an Instagram handle, a YouTube channel, or both."""

    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    handle: str = Field(default="", max_length=200)  # Instagram handle or profile link
    youtube: str = Field(default="", max_length=300)  # YouTube @handle or channel link
    whatsapp: str = Field(default="", max_length=40)
    followers: str = Field(default="", max_length=40)
    posted_from: str = Field(default="", max_length=120)


class CreatorStats(BaseModel):
    reels: int = 0
    reel_imports: int = 0
    link_visits: int = 0
    credited_travellers: int = 0
    trips_planned: int = 0
    earned_paise: int = 0
    paid_paise: int = 0


class CreatorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    platform: str
    handle: str | None = None
    email: str | None = None
    display_name: str
    profile_url: str
    youtube_url: str | None = None
    status: CreatorStatus
    referral_code: str
    commission_per_user_paise: int
    commission_type: CommissionType
    commission_value: int
    notes: str
    created_at: datetime
    stats: CreatorStats = CreatorStats()


class CreatorUpdate(BaseModel):
    handle: str | None = Field(default=None, max_length=100)
    display_name: str | None = Field(default=None, max_length=255)
    status: CreatorStatus | None = None
    commission_per_user_paise: int | None = Field(default=None, ge=0, le=10_000_000)
    commission_type: CommissionType | None = None
    # Basis points when type is percent (max 10000 = 100%), paise when flat.
    commission_value: int | None = Field(default=None, ge=0, le=100_000_000)
    notes: str | None = None


class CreatorProfileUpdate(BaseModel):
    """What a creator can change about their own page. The handle is staff's to set: it is
    their address and their identity with us."""

    display_name: str = Field(min_length=2, max_length=80)


class CreatorMe(BaseModel):
    """What a signed-in creator sees about their own account."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None = None
    handle: str | None = None
    display_name: str
    youtube_url: str | None = None
    status: CreatorStatus
    referral_code: str
    commission_type: CommissionType
    commission_value: int
    # Their profile photo and cover photo, when they have added them.
    avatar_url: str | None = None
    cover_url: str | None = None


class CreatorReel(BaseModel):
    shortcode: str
    url: str
    thumbnail_url: str | None
    destination_name: str
    summary: str
    places: int
    verified_places: int
    imports: int
    created_at: datetime


class AttributionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event: AttributionEvent
    source: AttributionSource
    user_email: str | None = None
    created_at: datetime


class CommissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_email: str | None = None
    event: AttributionEvent
    amount_paise: int
    status: CommissionStatus
    created_at: datetime


class CreatorDetail(CreatorRead):
    reels: list[CreatorReel]
    activity: list[AttributionRead]
    commissions: list[CommissionRead]


class CreatorOverview(CreatorMe):
    """A signed-in creator's own dashboard: the admin view of them, minus anything about other
    people (traveller emails are never included) and minus staff notes."""

    profile_url: str = ""
    created_at: datetime
    stats: CreatorStats
    reels: list[CreatorReel]
    activity: list[AttributionRead]
    commissions: list[CommissionRead]


class CommissionUpdate(BaseModel):
    status: CommissionStatus


class ReferralVisit(BaseModel):
    visitor_id: str = Field(default="", max_length=64)


class ReferralRead(BaseModel):
    """Public: what the website shows on a creator's link."""

    handle: str
    display_name: str
    referral_code: str


class TripItem(BaseModel):
    id: str
    kind: str
    name: str
    note: str = ""
    day: int | None = None
    location_id: str | None = None
    verified: bool = False
    # Seconds into the reel where this place showed up.
    t: float | None = None
    # reel: named in the creator's video · kb: WishTrip's checked place · suggested: the AI's
    # suggestion, neither from the video nor checked · creator: a stop the creator added by hand.
    origin: Literal["reel", "kb", "suggested", "creator"] = "reel"


class CreatorTripRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    destination_name: str
    summary: str
    cover_image_url: str | None = None
    source_shortcode: str | None = None
    items: list[TripItem]
    status: TripStatus
    share_code: str | None = None
    created_at: datetime
    updated_at: datetime


class TripImportStart(BaseModel):
    url: str = Field(min_length=1, max_length=1000)


class CreatorTripUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    summary: str | None = Field(default=None, max_length=2000)
    items: list[TripItem] | None = None
    publish: bool | None = None
    # One of the keys from /creator/trips/{id}/cover-options.
    cover_image_key: str | None = Field(default=None, max_length=500)


class CoverOption(BaseModel):
    key: str
    url: str
    # Seconds into the video; null for the reel's own cover and for uploaded images.
    t: float | None = None
    source: Literal["video", "reel_cover", "upload"]
    current: bool = False


class CoverUpload(BaseModel):
    filename: str = Field(max_length=200)
    # The image file, base64-encoded (the website gateway forwards JSON only).
    data_base64: str


class SaveFromReel(BaseModel):
    import_id: uuid.UUID
    title: str | None = Field(default=None, max_length=255)
    items: list[TripItem] | None = None


class PublicCreator(BaseModel):
    handle: str | None = None
    display_name: str
    referral_code: str


class PublicTripRead(BaseModel):
    """A published creator trip, shown on the shareable /t/<code> link."""

    title: str
    destination_name: str
    summary: str
    cover_image_url: str | None = None
    creator: PublicCreator
    items: list[TripItem]


class LinkStats(BaseModel):
    visits: int = 0
    signups: int = 0
    trips_planned: int = 0
    earned_paise: int = 0


class LinkDestination(BaseModel):
    id: uuid.UUID
    name: str
    region: str = ""


class CreatorLinkRead(BaseModel):
    """One reel link on the creator's dashboard."""

    id: uuid.UUID
    code: str
    label: str
    destination: LinkDestination | None
    instagram_url: str | None
    youtube_url: str | None
    auto_publish: bool
    # waiting: no reel link yet · unread: has one, but no itinerary (YouTube can't be read yet) ·
    # building: being read · failed: couldn't be read · ready: a draft itinerary · published.
    status: Literal["waiting", "unread", "building", "failed", "ready", "published"]
    # While building: which step the reel is on (see ImportStep). While failed: why.
    step: str | None = None
    error: str = ""
    trip_id: uuid.UUID | None = None
    share_code: str | None = None
    # A picture from the reel, for the card and the itinerary.
    cover_image_url: str | None = None
    created_at: datetime
    stats: LinkStats


class CreatorLinkCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    destination_id: uuid.UUID | None = None


class CreatorLinkUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    # A blank string removes the reel again; a value attaches (or replaces) it.
    instagram_url: str | None = Field(default=None, max_length=500)
    youtube_url: str | None = Field(default=None, max_length=300)
    auto_publish: bool | None = None
    # Publish or unpublish the itinerary built from the reel.
    published: bool | None = None


class LinkVisit(BaseModel):
    """What the website needs to send a visitor on: who to credit and where to land."""

    referral_code: str
    link_code: str
    destination_id: uuid.UUID | None = None
    # Set once the creator has published the reel's itinerary: where the visitor should land.
    trip_share_code: str | None = None
