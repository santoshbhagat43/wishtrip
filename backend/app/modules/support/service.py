import statistics
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import not_found
from app.modules.chat.models import ChatMessage, ChatSession
from app.modules.knowledge.models import Tag
from app.modules.profiles.models import EventType, ProfileEvent, TravelerProfile
from app.modules.support import routing
from app.modules.support.models import (
    MessageAuthor,
    SupportMessage,
    SupportTicket,
    TicketStatus,
)
from app.modules.support.schemas import (
    AgentLoad,
    AssignmentLog,
    Inbox,
    InboxCounts,
    PersonRef,
    ReplyCreate,
    RoutingAgent,
    RoutingPreview,
    RoutingRead,
    RoutingUpdate,
    SupportMessageRead,
    TicketCreate,
    TicketListItem,
    TicketRead,
    TicketUpdate,
    TripContext,
)
from app.modules.users.models import Role, User

# Views the inbox offers, in the order the pills appear.
OPEN_STATUSES = (TicketStatus.OPEN, TicketStatus.WAITING_CUSTOMER)


def _minutes_since(value: datetime | None) -> int:
    if value is None:
        return 0
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return max(0, int((datetime.now(UTC) - value).total_seconds() // 60))


async def _trip_title(session: AsyncSession, ticket: SupportTicket) -> str | None:
    if not ticket.session_id:
        return None
    query = select(ChatSession.title).where(ChatSession.id == ticket.session_id)
    return await session.scalar(query)


def _to_list_item(ticket: SupportTicket, trip_title: str | None) -> TicketListItem:
    # "Waiting" is time since the traveler last wrote; that is what an agent owes a reply to.
    last_customer = max(
        (m.created_at for m in ticket.messages if m.author == MessageAuthor.CUSTOMER),
        default=ticket.created_at,
    )
    return TicketListItem(
        id=ticket.id,
        number=ticket.number,
        subject=ticket.subject,
        status=ticket.status,
        priority=ticket.priority,
        channel=ticket.channel,
        in_destination=ticket.in_destination,
        user=PersonRef.model_validate(ticket.user),
        assignee=PersonRef.model_validate(ticket.assignee) if ticket.assignee else None,
        trip_title=trip_title,
        age_minutes=_minutes_since(ticket.created_at),
        waiting_minutes=_minutes_since(last_customer),
        first_response_at=ticket.first_response_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


async def inbox(
    session: AsyncSession,
    *,
    viewer: User,
    view: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> Inbox:
    await routing.sweep_overdue(session)
    tickets = list(
        await session.scalars(select(SupportTicket).options(selectinload(SupportTicket.messages)))
    )
    counts = InboxCounts(
        open=sum(1 for t in tickets if t.status in OPEN_STATUSES),
        unassigned=sum(1 for t in tickets if t.status in OPEN_STATUSES and not t.assignee_id),
        mine=sum(1 for t in tickets if t.status in OPEN_STATUSES and t.assignee_id == viewer.id),
        urgent=sum(1 for t in tickets if t.status in OPEN_STATUSES and t.priority == "urgent"),
        in_destination=sum(1 for t in tickets if t.status in OPEN_STATUSES and t.in_destination),
        waiting_customer=sum(1 for t in tickets if t.status == TicketStatus.WAITING_CUSTOMER),
        resolved=sum(1 for t in tickets if t.status == TicketStatus.RESOLVED),
    )

    selected = {
        "open": [t for t in tickets if t.status in OPEN_STATUSES],
        "unassigned": [t for t in tickets if t.status in OPEN_STATUSES and not t.assignee_id],
        "mine": [t for t in tickets if t.status in OPEN_STATUSES and t.assignee_id == viewer.id],
        "urgent": [t for t in tickets if t.status in OPEN_STATUSES and t.priority == "urgent"],
        "in_destination": [t for t in tickets if t.status in OPEN_STATUSES and t.in_destination],
        "resolved": [t for t in tickets if t.status == TicketStatus.RESOLVED],
    }.get(view or "open", tickets)

    if q:
        needle = q.lower()
        selected = [
            t
            for t in selected
            if needle in t.subject.lower()
            or needle in t.user.full_name.lower()
            or needle in t.user.email.lower()
            or needle in str(t.number)
        ]

    # Someone in destination first, then urgency, then whoever has waited longest.
    priority_rank = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
    selected.sort(
        key=lambda t: (not t.in_destination, priority_rank.get(t.priority, 9), t.created_at)
    )

    replied = [
        (t.first_response_at - t.created_at).total_seconds() / 60
        for t in tickets
        if t.first_response_at
    ]
    start = (page - 1) * page_size
    page_items = selected[start : start + page_size]
    titles = {t.id: await _trip_title(session, t) for t in page_items}
    return Inbox(
        counts=counts,
        total=len(selected),
        median_first_reply_minutes=round(statistics.median(replied)) if replied else None,
        items=[_to_list_item(t, titles[t.id]) for t in page_items],
    )


async def _context(session: AsyncSession, ticket: SupportTicket) -> TripContext:
    """Everything we genuinely hold about this traveler — no bookings, because there are none."""
    profile = await session.get(TravelerProfile, ticket.user_id)
    interests: list[str] = []
    if profile and profile.interest_tag_ids:
        interests = list(
            await session.scalars(select(Tag.name).where(Tag.id.in_(profile.interest_tag_ids)))
        )
    saved = await session.scalar(
        select(func.count()).where(
            ProfileEvent.user_id == ticket.user_id, ProfileEvent.event_type == EventType.SELECTED
        )
    )
    trips = await session.scalar(select(func.count()).where(ChatSession.user_id == ticket.user_id))
    past = await session.scalar(
        select(func.count()).where(
            SupportTicket.user_id == ticket.user_id, SupportTicket.id != ticket.id
        )
    )

    state: dict = {}
    itinerary: list[dict] = []
    if ticket.session_id:
        chat = await session.get(ChatSession, ticket.session_id)
        state = chat.state if chat else {}
        # The last plan the traveler was shown is the one they are asking about.
        last_plan = await session.scalar(
            select(ChatMessage)
            .where(ChatMessage.session_id == ticket.session_id, ChatMessage.itinerary != [])
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        itinerary = (last_plan.itinerary if last_plan else []) or []

    return TripContext(
        companions=profile.companions if profile else None,
        budget_level=profile.budget_level if profile else None,
        energy_level=profile.energy_level if profile else None,
        accessibility_needs=bool(profile and profile.accessibility_needs),
        interests=interests,
        saved_places=saved or 0,
        trips_planned=trips or 0,
        destination=state.get("destination"),
        duration_days=state.get("duration_days"),
        start_date=state.get("start_date"),
        itinerary=itinerary,
        past_tickets=past or 0,
    )


async def get_ticket(session: AsyncSession, ticket_id: uuid.UUID) -> TicketRead:
    ticket = await session.get(
        SupportTicket,
        ticket_id,
        options=[selectinload(SupportTicket.messages)],
        populate_existing=True,
    )
    if not ticket:
        raise not_found("Ticket not found")
    base = _to_list_item(ticket, await _trip_title(session, ticket))
    return TicketRead(
        **base.model_dump(),
        messages=[
            SupportMessageRead(
                id=m.id,
                author=m.author,
                author_name=m.author_user.full_name if m.author_user else ticket.user.full_name,
                body=m.body,
                created_at=m.created_at,
            )
            for m in ticket.messages
        ],
        context=await _context(session, ticket),
    )


async def create_ticket(session: AsyncSession, user: User, data: TicketCreate) -> SupportTicket:
    ticket = SupportTicket(
        user_id=user.id,
        session_id=data.session_id,
        subject=data.subject,
        channel=data.channel,
        in_destination=data.in_destination,
        priority="urgent" if data.in_destination else "normal",
    )
    session.add(ticket)
    await session.flush()
    session.add(SupportMessage(ticket_id=ticket.id, author=MessageAuthor.CUSTOMER, body=data.body))
    # Route it by the team's own rules, and record why it went where it did.
    chat = await session.get(ChatSession, data.session_id) if data.session_id else None
    destination = (chat.state or {}).get("destination") if chat else None
    await routing.assign(session, ticket, hints=routing.ticket_hints(ticket, destination))
    await session.commit()
    await session.refresh(ticket)
    return ticket


async def update_ticket(
    session: AsyncSession, ticket_id: uuid.UUID, data: TicketUpdate
) -> TicketRead:
    ticket = await session.get(SupportTicket, ticket_id)
    if not ticket:
        raise not_found("Ticket not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ticket, field, value)
    if data.status == TicketStatus.RESOLVED and not ticket.resolved_at:
        ticket.resolved_at = datetime.now(UTC)
    if data.status and data.status != TicketStatus.RESOLVED:
        ticket.resolved_at = None
    await session.commit()
    return await get_ticket(session, ticket_id)


async def reply(
    session: AsyncSession, ticket_id: uuid.UUID, agent: User, data: ReplyCreate
) -> TicketRead:
    ticket = await session.get(SupportTicket, ticket_id)
    if not ticket:
        raise not_found("Ticket not found")
    session.add(
        SupportMessage(
            ticket_id=ticket.id,
            author=MessageAuthor.NOTE if data.internal else MessageAuthor.AGENT,
            author_id=agent.id,
            body=data.body,
        )
    )
    # An internal note is not a reply to the traveler, so it never stops the clock.
    if not data.internal:
        if not ticket.first_response_at:
            ticket.first_response_at = datetime.now(UTC)
        if not ticket.assignee_id:
            ticket.assignee_id = agent.id
        ticket.status = TicketStatus.RESOLVED if data.resolve else TicketStatus.WAITING_CUSTOMER
        if data.resolve:
            ticket.resolved_at = datetime.now(UTC)
    await session.commit()
    return await get_ticket(session, ticket_id)


async def agents(session: AsyncSession) -> list[AgentLoad]:
    """Staff who can hold tickets, with what they are already carrying."""
    staff = list(
        await session.scalars(
            select(User).where(
                User.role.in_((Role.SUPPORT, Role.ADMIN, Role.EDITOR)),
                User.is_active.is_(True),
            )
        )
    )
    open_counts = dict(
        (
            await session.execute(
                select(SupportTicket.assignee_id, func.count())
                .where(SupportTicket.status.in_(OPEN_STATUSES))
                .group_by(SupportTicket.assignee_id)
            )
        ).all()
    )
    return [
        AgentLoad(
            id=u.id,
            full_name=u.full_name,
            email=u.email,
            role=u.role,
            open_tickets=open_counts.get(u.id, 0),
        )
        for u in sorted(staff, key=lambda u: u.full_name)
    ]


async def my_tickets(session: AsyncSession, user: User) -> list[TicketListItem]:
    tickets = list(
        await session.scalars(
            select(SupportTicket)
            .options(selectinload(SupportTicket.messages))
            .where(SupportTicket.user_id == user.id)
            .order_by(SupportTicket.created_at.desc())
        )
    )
    return [_to_list_item(t, await _trip_title(session, t)) for t in tickets]


async def routing_settings(session: AsyncSession) -> RoutingRead:
    """Everything the routing screen renders, including who is next right now."""
    config = await routing.config(session)
    rows = await routing.agent_rows(session)
    counts = await routing.open_counts(session)
    pick, reason = await routing.choose(session)
    return RoutingRead(
        method=config.method,
        reassign_after_minutes=config.reassign_after_minutes,
        agents=[
            RoutingAgent(
                user_id=row.user_id,
                full_name=row.user.full_name,
                email=row.user.email,
                role=row.user.role,
                position=row.position,
                in_rotation=row.in_rotation,
                availability=row.availability,
                capacity=row.capacity,
                handles=row.handles,
                open_tickets=counts.get(row.user_id, 0),
                is_next=bool(pick and pick.user_id == row.user_id),
            )
            for row in rows
        ],
        next_agent=(pick.user.full_name or pick.user.email) if pick else None,
        next_reason=reason,
        recent=[
            AssignmentLog(
                ticket_number=log.ticket.number,
                ticket_subject=log.ticket.subject,
                agent_name=(log.agent.full_name or log.agent.email) if log.agent else None,
                reason=log.reason,
                created_at=log.created_at,
            )
            for log in await routing.recent(session)
        ],
    )


async def save_routing(session: AsyncSession, data: RoutingUpdate) -> RoutingRead:
    config = await routing.config(session)
    for field, value in data.model_dump(exclude_unset=True).items():
        # 0 minutes means "off", which is how the screen's Off option arrives.
        setattr(config, field, None if field == "reassign_after_minutes" and not value else value)
    await session.commit()
    return await routing_settings(session)


async def save_agent(session: AsyncSession, user_id: uuid.UUID, data: dict) -> RoutingRead:
    await routing.update_agent(session, user_id, data)
    return await routing_settings(session)


async def preview_routing(
    session: AsyncSession, *, destination: str | None = None, channel: str = "in_app"
) -> RoutingPreview:
    """Try it: who would take a ticket like this? Nothing is written."""
    hints = [h for h in (destination, channel) if h]
    pick, reason = await routing.choose(session, hints=hints)
    return RoutingPreview(
        agent_name=(pick.user.full_name or pick.user.email) if pick else None, reason=reason
    )
