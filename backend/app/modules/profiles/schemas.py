import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.knowledge.models import TimeOfDay
from app.modules.knowledge.schemas import LocationRef
from app.modules.profiles.models import Companions, EventType


class ProfileFields(BaseModel):
    budget_level: int | None = Field(None, ge=0, le=4)
    energy_level: int | None = Field(None, ge=1, le=5)
    companions: Companions | None = None
    travel_styles: list[str] = []
    food_preferences: list[str] = []
    preferred_times: list[TimeOfDay] = []
    interest_tag_ids: list[uuid.UUID] = []
    accommodation_preference: str = ""
    accessibility_needs: bool = False
    notes: str = Field("", max_length=1000)


class ProfileRead(ProfileFields):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    updated_at: datetime | None = None


class EventCreate(BaseModel):
    location_id: uuid.UUID
    event_type: EventType


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    location_id: uuid.UUID
    event_type: EventType
    created_at: datetime


class TravelerSummary(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    profile: ProfileRead | None
    event_count: int


class RecentEvent(BaseModel):
    event: EventRead
    location: LocationRef


class TravelerDetail(TravelerSummary):
    recent_events: list[RecentEvent]
