import enum
import uuid
from datetime import datetime

from sqlalchemy import ARRAY, BigInteger, DateTime, ForeignKey, Identity, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class TicketStatus(enum.StrEnum):
    OPEN = "open"
    WAITING_CUSTOMER = "waiting_customer"
    RESOLVED = "resolved"


class TicketPriority(enum.StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class TicketChannel(enum.StrEnum):
    IN_APP = "in_app"
    EMAIL = "email"
    WHATSAPP = "whatsapp"
    PHONE = "phone"


class MessageAuthor(enum.StrEnum):
    CUSTOMER = "customer"
    AGENT = "agent"
    # Staff-only: never sent to the traveler.
    NOTE = "note"


class SupportTicket(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "support_tickets"

    # Short human reference agents say out loud: "#1042".
    number: Mapped[int] = mapped_column(BigInteger, Identity(start=1000), unique=True, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # The trip this is about, when the traveler raised it from a conversation.
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="SET NULL"), index=True
    )
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    subject: Mapped[str] = mapped_column(String(255))
    status: Mapped[TicketStatus] = mapped_column(str_enum(TicketStatus), default=TicketStatus.OPEN)
    priority: Mapped[TicketPriority] = mapped_column(
        str_enum(TicketPriority), default=TicketPriority.NORMAL
    )
    channel: Mapped[TicketChannel] = mapped_column(
        str_enum(TicketChannel), default=TicketChannel.IN_APP
    )
    # Someone already travelling comes first, whatever else is in the queue.
    in_destination: Mapped[bool] = mapped_column(default=False)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship(foreign_keys=[user_id], lazy="joined")  # noqa: F821
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assignee_id], lazy="joined")  # noqa: F821
    messages: Mapped[list["SupportMessage"]] = relationship(
        back_populates="ticket", order_by="SupportMessage.created_at", cascade="all, delete-orphan"
    )


class SupportMessage(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "support_messages"

    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True
    )
    author: Mapped[MessageAuthor] = mapped_column(str_enum(MessageAuthor))
    # Null for the traveler's own messages, set for staff replies and notes.
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)

    ticket: Mapped[SupportTicket] = relationship(back_populates="messages")
    author_user: Mapped["User | None"] = relationship(lazy="joined")  # noqa: F821


class RoutingMethod(enum.StrEnum):
    """How a new ticket finds an agent."""

    ROUND_ROBIN = "round_robin"
    LEAST_BUSY = "least_busy"
    MANUAL = "manual"


class Availability(enum.StrEnum):
    ONLINE = "online"
    AWAY = "away"
    OFF_SHIFT = "off_shift"


class SupportRouting(UUIDPrimaryKey, Timestamps, Base):
    """One row: how the team wants tickets assigned."""

    __tablename__ = "support_routing"

    method: Mapped[RoutingMethod] = mapped_column(
        str_enum(RoutingMethod), default=RoutingMethod.ROUND_ROBIN
    )
    # Move a ticket to the next agent if nobody has replied within this long. None = off.
    reassign_after_minutes: Mapped[int | None]


class AgentRouting(Timestamps, Base):
    """Per-agent routing settings. A row appears the first time routing is opened."""

    __tablename__ = "support_agent_routing"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    in_rotation: Mapped[bool] = mapped_column(default=True)
    availability: Mapped[Availability] = mapped_column(
        str_enum(Availability), default=Availability.ONLINE
    )
    # How many open tickets this agent will hold at once.
    capacity: Mapped[int] = mapped_column(default=10)
    position: Mapped[int] = mapped_column(default=0)
    # What this agent is best placed to take: destinations, channels, topics.
    handles: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)

    user: Mapped["User"] = relationship(lazy="joined")  # noqa: F821


class TicketAssignment(UUIDPrimaryKey, Base):
    """Every assignment, and why it happened. Read on the routing screen."""

    __tablename__ = "support_assignments"

    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket: Mapped[SupportTicket] = relationship(lazy="joined")
    agent: Mapped["User | None"] = relationship(lazy="joined")  # noqa: F821
