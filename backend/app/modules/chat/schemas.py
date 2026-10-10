import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.modules.chat.models import Grounding, MessageRole


class Suggestion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    type: str
    location_id: uuid.UUID | None
    from_knowledge_base: bool
    is_placeholder: bool
    day: int | None
    time_of_day: str | None
    duration_minutes: int | None
    # Always null unless the knowledge base holds a price; the UI shows "not available yet".
    price: str | None
    why: str


class ScheduledItem(Suggestion):
    start: str
    end: str
    duration_estimated: bool
    travel_minutes_before: int
    travel_estimated: bool


class ItineraryDay(BaseModel):
    day: int
    date: str | None
    weekday: str | None
    capacity_minutes: int
    activity_minutes: int
    meal_minutes: int = 0
    travel_minutes: int
    items: list[ScheduledItem]


class FeasibilityIssue(BaseModel):
    severity: str
    code: str
    message: str
    day: int | None
    name: str | None


class Feasibility(BaseModel):
    status: str
    changes: list[str]
    issues: list[FeasibilityIssue]


class Source(BaseModel):
    ref: str
    location_id: uuid.UUID
    name: str
    type: str
    city: str | None
    score: float | None
    similarity: float | None


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: MessageRole
    content: str
    intent: dict[str, Any] | None
    grounding: Grounding | None
    suggestions: list[Suggestion]
    sources: list[Source]
    follow_ups: list[str]
    validation_notes: list[str]
    itinerary: list[ItineraryDay] = []
    feasibility: Feasibility | None = None
    model: str
    created_at: datetime


class MessageDebugRead(MessageRead):
    debug: dict[str, Any]


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    state: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class SessionDetail(SessionRead):
    messages: list[MessageDebugRead]


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ChatTurn(BaseModel):
    session: SessionRead
    user_message: MessageRead
    assistant_message: MessageDebugRead
