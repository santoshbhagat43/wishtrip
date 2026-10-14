import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_staff, require_support
from app.db.session import get_session
from app.modules.support import service
from app.modules.support.schemas import (
    AgentLoad,
    AgentRoutingUpdate,
    Inbox,
    ReplyCreate,
    RoutingPreview,
    RoutingRead,
    RoutingUpdate,
    TicketCreate,
    TicketListItem,
    TicketRead,
    TicketUpdate,
    TravelerMessageCreate,
    TravelerTicketRead,
)
from app.modules.users.models import User

router = APIRouter(tags=["support"])


@router.get("/admin/support/inbox", response_model=Inbox)
async def support_inbox(
    view: str | None = Query(
        None, pattern="^(open|unassigned|mine|urgent|in_destination|resolved)$"
    ),
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_support),
):
    """The queue an agent works from: counts for every view, then one view's tickets."""
    return await service.inbox(
        session, viewer=staff, view=view, q=q, page=page, page_size=page_size
    )


@router.get("/admin/support/agents", response_model=list[AgentLoad])
async def support_agents(
    session: AsyncSession = Depends(get_session), _: User = Depends(require_support)
):
    return await service.agents(session)


@router.get("/admin/support/tickets/{ticket_id}", response_model=TicketRead)
async def read_ticket(
    ticket_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_support),
):
    """The conversation plus everything we hold about the traveler and their trip."""
    return await service.get_ticket(session, ticket_id, staff)


@router.patch("/admin/support/tickets/{ticket_id}", response_model=TicketRead)
async def change_ticket(
    ticket_id: uuid.UUID,
    data: TicketUpdate,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_support),
):
    return await service.update_ticket(session, ticket_id, data, staff)


@router.post("/admin/support/tickets/{ticket_id}/reply", response_model=TicketRead, status_code=201)
async def reply_to_ticket(
    ticket_id: uuid.UUID,
    data: ReplyCreate,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_support),
):
    """A reply the traveler reads, or an internal note that stays with staff."""
    return await service.reply(session, ticket_id, staff, data)


@router.get("/support/tickets", response_model=list[TicketListItem])
async def my_tickets(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    return await service.my_tickets(session, user)


@router.get("/support/tickets/{ticket_id}", response_model=TravelerTicketRead)
async def read_my_ticket(
    ticket_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """The traveler's own thread: public messages only, never internal notes."""
    return await service.get_traveler_ticket(session, ticket_id, user)


@router.post(
    "/support/tickets/{ticket_id}/messages",
    response_model=TravelerTicketRead,
    status_code=201,
)
async def follow_up_my_ticket(
    ticket_id: uuid.UUID,
    data: TravelerMessageCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Traveler follow-up; reopens the ticket for the inbox when needed."""
    return await service.traveler_follow_up(session, ticket_id, user, data)


@router.post("/support/tickets", response_model=TicketListItem, status_code=201)
async def open_ticket(
    data: TicketCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """A traveler asks for help, optionally about a trip they are planning."""
    ticket = await service.create_ticket(session, user, data)
    return (await service.get_ticket(session, ticket.id)).model_dump()


@router.get("/admin/support/routing", response_model=RoutingRead)
async def read_routing(
    session: AsyncSession = Depends(get_session), _: User = Depends(require_support)
):
    """How tickets are assigned, who is next, and the recent assignment log."""
    return await service.routing_settings(session)


@router.put("/admin/support/routing", response_model=RoutingRead)
async def save_routing(
    data: RoutingUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    return await service.save_routing(session, data)


@router.patch("/admin/support/routing/agents/{user_id}", response_model=RoutingRead)
async def save_agent_routing(
    user_id: uuid.UUID,
    data: AgentRoutingUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """Availability, limit, rotation order and what an agent handles."""
    return await service.save_agent(session, user_id, data.model_dump(exclude_unset=True))


@router.get("/admin/support/routing/preview", response_model=RoutingPreview)
async def preview_routing(
    destination: str | None = None,
    channel: str = "in_app",
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_support),
):
    """A dry run: who would take a ticket like this, and why. Writes nothing."""
    return await service.preview_routing(session, destination=destination, channel=channel)
