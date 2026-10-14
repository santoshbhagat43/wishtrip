import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.support.models import (
    Availability,
    MessageAuthor,
    RoutingMethod,
    TicketChannel,
    TicketPriority,
    TicketStatus,
)


class PersonRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: str


class SupportMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author: MessageAuthor
    author_name: str
    body: str
    created_at: datetime


class TicketListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    number: int
    subject: str
    status: TicketStatus
    priority: TicketPriority
    channel: TicketChannel
    in_destination: bool
    user: PersonRef
    assignee: PersonRef | None
    trip_title: str | None
    # Minutes since the ticket arrived, and since a traveler last wrote.
    age_minutes: int
    waiting_minutes: int
    first_response_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TripContext(BaseModel):
    """What we actually hold about this traveler, for the agent's side panel."""

    companions: str | None
    budget_level: int | None
    energy_level: int | None
    accessibility_needs: bool
    interests: list[str]
    saved_places: int
    trips_planned: int
    destination: str | None
    duration_days: int | None
    start_date: str | None
    itinerary: list[dict]
    past_tickets: int


class TicketRead(TicketListItem):
    messages: list[SupportMessageRead]
    context: TripContext


class TravelerTicketRead(BaseModel):
    """Ticket thread for the traveler who owns it — no staff context or internal notes."""

    id: uuid.UUID
    number: int
    subject: str
    status: TicketStatus
    created_at: datetime
    updated_at: datetime
    messages: list[SupportMessageRead]


class TravelerMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class TicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=255)
    body: str = Field(min_length=1, max_length=4000)
    session_id: uuid.UUID | None = None
    channel: TicketChannel = TicketChannel.IN_APP
    in_destination: bool = False


class TicketUpdate(BaseModel):
    status: TicketStatus | None = None
    priority: TicketPriority | None = None
    assignee_id: uuid.UUID | None = None
    in_destination: bool | None = None


class ReplyCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    # A note stays staff-only; a reply is what the traveler reads.
    internal: bool = False
    resolve: bool = False


class InboxCounts(BaseModel):
    open: int
    unassigned: int
    mine: int
    urgent: int
    in_destination: int
    waiting_customer: int
    resolved: int


class Inbox(BaseModel):
    counts: InboxCounts
    total: int
    # Minutes between a ticket arriving and an agent's first reply, median over replied tickets.
    median_first_reply_minutes: int | None
    items: list[TicketListItem]


class AgentLoad(BaseModel):
    """Who can take work, and how much they are holding. Used by the inbox assignee picker."""

    id: uuid.UUID
    full_name: str
    email: str
    role: str
    open_tickets: int


class RoutingAgent(BaseModel):
    """An agent as the routing screen shows them."""

    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    full_name: str
    email: str
    role: str
    position: int
    in_rotation: bool
    availability: Availability
    capacity: int
    handles: list[str]
    open_tickets: int
    # True for whoever the current settings would give the next ticket to.
    is_next: bool


class AssignmentLog(BaseModel):
    ticket_number: int
    ticket_subject: str
    agent_name: str | None
    reason: str
    created_at: datetime


class RoutingRead(BaseModel):
    method: RoutingMethod
    reassign_after_minutes: int | None
    agents: list[RoutingAgent]
    # Who is next, and the sentence explaining it.
    next_agent: str | None
    next_reason: str
    recent: list[AssignmentLog]


class RoutingUpdate(BaseModel):
    method: RoutingMethod | None = None
    reassign_after_minutes: int | None = Field(None, ge=0, le=24 * 60)


class AgentRoutingUpdate(BaseModel):
    in_rotation: bool | None = None
    availability: Availability | None = None
    capacity: int | None = Field(None, ge=0, le=100)
    position: int | None = Field(None, ge=0, le=999)
    handles: list[str] | None = None


class RoutingPreview(BaseModel):
    """A dry run: who would take a ticket like this, and why. Writes nothing."""

    agent_name: str | None
    reason: str
