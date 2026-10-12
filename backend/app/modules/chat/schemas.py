import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    # The place's tips from the knowledge base, passed on as written by staff.
    tip: str | None = None


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


class FollowUp(BaseModel):
    """A question the assistant asks the traveler, with replies they can send as they are."""

    question: str
    answers: list[str] = []


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: MessageRole
    content: str
    intent: dict[str, Any] | None
    grounding: Grounding | None
    suggestions: list[Suggestion]
    sources: list[Source]
    follow_ups: list[FollowUp]
    validation_notes: list[str]
    itinerary: list[ItineraryDay] = []
    feasibility: Feasibility | None = None
    model: str
    created_at: datetime

    @field_validator("follow_ups", mode="before")
    @classmethod
    def _questions_without_answers(cls, value: Any) -> Any:
        # Older messages stored plain question strings.
        return [{"question": q} if isinstance(q, str) else q for q in value or []]


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
