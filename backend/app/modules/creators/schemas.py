import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.creators.models import (
    AttributionEvent,
    AttributionSource,
    CommissionStatus,
    CommissionType,
    CreatorStatus,
)


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


class CreatorMe(BaseModel):
    """What a signed-in creator sees about their own account."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None = None
    handle: str | None = None
    display_name: str
    status: CreatorStatus
    referral_code: str
    commission_type: CommissionType
    commission_value: int


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


class CommissionUpdate(BaseModel):
    status: CommissionStatus


class ReferralVisit(BaseModel):
    visitor_id: str = Field(default="", max_length=64)


class ReferralRead(BaseModel):
    """Public: what the website shows on a creator's link."""

    handle: str
    display_name: str
    referral_code: str
