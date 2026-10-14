"""Who gets the next ticket, and why.

Every decision is written to `support_assignments` with a sentence explaining it, so the
routing screen can show what actually happened rather than what the settings imply.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.modules.support.models import (
    AgentRouting,
    Availability,
    RoutingMethod,
    SupportRouting,
    SupportTicket,
    TicketAssignment,
    TicketStatus,
)
from app.modules.users.models import Role, User

OPEN_STATUSES = (TicketStatus.OPEN, TicketStatus.WAITING_CUSTOMER)


async def config(session: AsyncSession) -> SupportRouting:
    """The team's routing settings, created with sensible defaults on first use."""
    existing = await session.scalar(select(SupportRouting).limit(1))
    if existing:
        return existing
    created = SupportRouting()
    session.add(created)
    await session.commit()
    await session.refresh(created)
    return created


# Support agents first; admin/editor can still be in the rotation when needed.
_AGENT_ROLES = (Role.SUPPORT, Role.ADMIN, Role.EDITOR)


async def agent_rows(session: AsyncSession) -> list[AgentRouting]:
    """One routing row per staff account, in rotation order."""
    staff = list(
        await session.scalars(
            select(User).where(User.role.in_(_AGENT_ROLES), User.is_active.is_(True))
        )
    )
    rows = {r.user_id: r for r in await session.scalars(select(AgentRouting))}
    missing = [u for u in staff if u.id not in rows]
    if missing:
        start = max((r.position for r in rows.values()), default=0)
        for offset, user in enumerate(sorted(missing, key=lambda u: u.full_name or u.email), 1):
            session.add(AgentRouting(user_id=user.id, position=start + offset))
        await session.commit()
        rows = {r.user_id: r for r in await session.scalars(select(AgentRouting))}
    # Staff who have since been deactivated keep their row but drop out of routing.
    active = sorted(
        (rows[u.id] for u in staff if u.id in rows),
        key=lambda r: (r.position, r.user.full_name or r.user.email),
    )
    # Keep the rotation numbered 1..n: new agents and departures leave gaps and ties otherwise,
    # and "next in the rotation" has to be unambiguous.
    renumbered = False
    for index, row in enumerate(active, start=1):
        if row.position != index:
            row.position = index
            renumbered = True
    if renumbered:
        await session.commit()
    return active


async def open_counts(session: AsyncSession) -> dict[uuid.UUID, int]:
    return dict(
        (
            await session.execute(
                select(SupportTicket.assignee_id, func.count())
                .where(SupportTicket.status.in_(OPEN_STATUSES))
                .group_by(SupportTicket.assignee_id)
            )
        ).all()
    )


def _eligible(rows: list[AgentRouting], counts: dict[uuid.UUID, int]) -> list[AgentRouting]:
    return [
        r
        for r in rows
        if r.in_rotation
        and r.availability == Availability.ONLINE
        and counts.get(r.user_id, 0) < r.capacity
    ]


def _handles(row: AgentRouting, ticket_hints: list[str]) -> bool:
    """Does this agent's "handles" list mention the destination, channel or priority?"""
    wanted = {h.lower() for h in row.handles}
    return any(hint and hint.lower() in wanted for hint in ticket_hints)


async def choose(
    session: AsyncSession,
    *,
    hints: list[str] | None = None,
    exclude: uuid.UUID | None = None,
) -> tuple[AgentRouting | None, str]:
    """Pick the agent for a ticket and say why. Never writes anything."""
    settings = await config(session)
    rows = [r for r in await agent_rows(session) if r.user_id != exclude]
    counts = await open_counts(session)
    available = _eligible(rows, counts)
    # Prefer the support role when any support agent is free.
    support_only = [r for r in available if r.user.role == Role.SUPPORT]
    if support_only:
        available = support_only

    if settings.method == RoutingMethod.MANUAL:
        return None, "Manual assignment is on, so new tickets wait in Unassigned."
    if not available:
        if not any(r.in_rotation for r in rows):
            return None, "Nobody is in the rotation, so the ticket waits in Unassigned."
        blocked = [r for r in rows if r.in_rotation and r.availability == Availability.ONLINE]
        if blocked:
            return None, "Everyone online is at their limit, so the ticket waits in Unassigned."
        return None, "Nobody is online, so the ticket waits in Unassigned."

    # A matching "handles" entry wins before the method is applied.
    matching = [r for r in available if _handles(r, hints or [])] if hints else []
    pool = matching or available
    matched = bool(matching)

    if settings.method == RoutingMethod.LEAST_BUSY:
        pick = min(pool, key=lambda r: (counts.get(r.user_id, 0), r.position))
        why = f"has the fewest open tickets ({counts.get(pick.user_id, 0)})"
    else:
        last = await session.scalar(
            select(TicketAssignment)
            .where(TicketAssignment.agent_id.isnot(None))
            .order_by(TicketAssignment.created_at.desc())
            .limit(1)
        )
        order = sorted(pool, key=lambda r: r.position)
        pick = order[0]
        if last and last.agent_id:
            after = [r for r in order if r.position > _position(rows, last.agent_id)]
            pick = after[0] if after else order[0]
        why = "is next in the rotation"

    name = pick.user.full_name or pick.user.email
    reason = f"{name} {why}"
    if matched:
        hit = next(h for h in (hints or []) if h and h.lower() in {x.lower() for x in pick.handles})
        reason += f", and handles {hit}"
    return pick, reason


def _position(rows: list[AgentRouting], user_id: uuid.UUID) -> int:
    return next((r.position for r in rows if r.user_id == user_id), 0)


def ticket_hints(ticket: SupportTicket, destination: str | None) -> list[str]:
    hints = [destination, str(ticket.channel)]
    if ticket.in_destination:
        hints.append("in destination")
    if ticket.priority == "urgent":
        hints.append("urgent")
    return [h for h in hints if h]


async def assign(
    session: AsyncSession,
    ticket: SupportTicket,
    *,
    hints: list[str] | None = None,
    exclude: uuid.UUID | None = None,
) -> str:
    """Route a ticket now, record the decision, and return the reason."""
    pick, reason = await choose(session, hints=hints, exclude=exclude)
    ticket.assignee_id = pick.user_id if pick else None
    session.add(
        TicketAssignment(
            ticket_id=ticket.id, agent_id=pick.user_id if pick else None, reason=reason
        )
    )
    return reason


async def sweep_overdue(session: AsyncSession) -> int:
    """Move tickets nobody has replied to on to the next agent.

    Called whenever an agent loads the inbox, so the rule applies without a scheduler. The
    same function is safe to run from a periodic task later.
    """
    settings = await config(session)
    if not settings.reassign_after_minutes:
        return 0
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.reassign_after_minutes)
    overdue = list(
        await session.scalars(
            select(SupportTicket).where(
                SupportTicket.status == TicketStatus.OPEN,
                SupportTicket.first_response_at.is_(None),
                SupportTicket.assignee_id.isnot(None),
                SupportTicket.created_at < cutoff,
            )
        )
    )
    moved = 0
    for ticket in overdue:
        previous = ticket.assignee_id
        pick, reason = await choose(session, exclude=previous)
        if not pick or pick.user_id == previous:
            continue
        ticket.assignee_id = pick.user_id
        session.add(
            TicketAssignment(
                ticket_id=ticket.id,
                agent_id=pick.user_id,
                reason=(
                    f"Moved on: no first reply within {settings.reassign_after_minutes} min. "
                    f"{reason}"
                ),
            )
        )
        moved += 1
    if moved:
        await session.commit()
    return moved


async def recent(session: AsyncSession, limit: int = 12) -> list[TicketAssignment]:
    return list(
        await session.scalars(
            select(TicketAssignment).order_by(TicketAssignment.created_at.desc()).limit(limit)
        )
    )


async def update_agent(session: AsyncSession, user_id: uuid.UUID, changes: dict) -> AgentRouting:
    row = await session.get(AgentRouting, user_id)
    if not row:
        raise not_found("That agent has no routing row yet")
    for field, value in changes.items():
        setattr(row, field, value)
    await session.commit()
    await session.refresh(row)
    return row
