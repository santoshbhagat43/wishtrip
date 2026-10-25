"""Seed the support inbox and the traveler site's menus. Safe to run repeatedly.

Tickets are written against real travelers and their real trip conversations, so the agent
console shows genuine context rather than invented customers.
"""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.modules.chat.models import ChatSession
from app.modules.knowledge.models import Location, LocationStatus, LocationType
from app.modules.menus.models import MenuGroup, MenuItem, MenuPlacement
from app.modules.support.models import (
    AgentRouting,
    MessageAuthor,
    SupportMessage,
    SupportTicket,
    TicketChannel,
    TicketPriority,
    TicketStatus,
)
from app.modules.users.models import Role, User

TICKETS = [
    {
        "subject": "Our Munnar day looks too packed for my parents",
        "destination": "Munnar",
        "body": (
            "Hi — the plan has three stops on day 2 and my parents tire quickly. "
            "Could we drop one and keep the tea gardens?"
        ),
        "channel": TicketChannel.IN_APP,
        "priority": TicketPriority.NORMAL,
        "status": TicketStatus.OPEN,
        "hours_ago": 3,
    },
    {
        "subject": "Arrived in Goa, the beach shack on day 1 is closed",
        "destination": "Goa",
        "body": "We're here now and the place on tonight's plan has shut down. What else is nearby?",
        "channel": TicketChannel.WHATSAPP,
        "priority": TicketPriority.URGENT,
        "status": TicketStatus.OPEN,
        "in_destination": True,
        "hours_ago": 1,
    },
    {
        "subject": "Can you add a vegetarian option to every dinner?",
        "body": "We're all vegetarian. The plan looks great otherwise.",
        "channel": TicketChannel.EMAIL,
        "priority": TicketPriority.NORMAL,
        "status": TicketStatus.OPEN,
        "hours_ago": 20,
    },
    {
        "subject": "Trip dates moved to December — does the plan still work?",
        "destination": "Kyoto",
        "body": "We've shifted by three weeks. Anything that closes in December?",
        "channel": TicketChannel.IN_APP,
        "priority": TicketPriority.HIGH,
        "status": TicketStatus.WAITING_CUSTOMER,
        "hours_ago": 30,
        "reply": "It still works. Two places change their hours in December — I've noted both on your plan. Shall I shift day 3 to the morning?",
    },
    {
        "subject": "How accurate are the walking times between stops?",
        "destination": "Kerala",
        "body": "Some of the gaps look short. Are these measured or estimated?",
        "channel": TicketChannel.IN_APP,
        "priority": TicketPriority.LOW,
        "status": TicketStatus.RESOLVED,
        "hours_ago": 72,
        "reply": "Stored routes are exact; anything we estimate is labelled 'estimated' on the day. Nothing on your plan is a guess longer than 20 minutes.",
    },
]

# A support team, so the routing screen has a real rotation. Created without a usable
# password: an admin sets one from Staff users if these people need to sign in.
AGENTS = [
    {
        "full_name": "Arjun Menon",
        "email": "arjun.menon@wishtrip.test",
        "handles": ["Kerala", "whatsapp"],
    },
    {
        "full_name": "Leela Fernandes",
        "email": "leela.fernandes@wishtrip.test",
        "handles": ["Goa", "urgent"],
    },
    {"full_name": "Vikram Rao", "email": "vikram.rao@wishtrip.test", "handles": ["Japan", "email"]},
]

MENUS = [
    {
        "name": "Main navigation",
        "placement": MenuPlacement.HEADER,
        "items": [
            {"label": "Explore", "url": "/explore"},
            {"label": "Plan a trip", "url": "/arya"},
            {"label": "Saved", "url": "/saved"},
            {"label": "Help", "url": "/help"},
        ],
    },
    {
        "name": "Popular destinations",
        "placement": MenuPlacement.FOOTER,
        # Filled from real published cities below.
        "cities": ["Goa", "Munnar tea hills", "Fort Kochi", "Bangkok", "Kyoto"],
    },
    {
        "name": "Company",
        "placement": MenuPlacement.FOOTER,
        "items": [
            {"label": "About WishTrip", "url": "/about"},
            {"label": "How planning works", "url": "/how-it-works"},
            {"label": "Contact support", "url": "/support"},
        ],
    },
]


async def main() -> None:
    async with SessionLocal() as session:
        # Pair each ticket with a conversation that actually planned a trip, so the agent's
        # trip panel shows a real destination and a checked itinerary.
        planned = list(
            (
                await session.execute(
                    select(User, ChatSession)
                    .join(ChatSession, ChatSession.user_id == User.id)
                    .where(
                        User.role == Role.TRAVELER,
                        ~User.email.like("e2e-%"),
                        ~User.email.like("probe-%"),
                        ChatSession.state["destination"].as_string().isnot(None),
                    )
                    # One planning conversation per traveler, so the inbox shows five
                    # different people rather than the same one five times.
                    .distinct(User.id)
                    .order_by(User.id, ChatSession.created_at.desc())
                )
            ).all()
        )
        if not planned:
            print("No planned trips yet — run the main seed and plan a trip first.")
            return
        agent = await session.scalar(select(User).where(User.role != Role.TRAVELER).limit(1))

        for position, spec in enumerate(AGENTS, start=1):
            if await session.scalar(select(User).where(User.email == spec["email"])):
                continue
            agent_user = User(
                email=spec["email"],
                hashed_password=hash_password(secrets.token_urlsafe(24)),
                full_name=spec["full_name"],
                role=Role.EDITOR,
            )
            session.add(agent_user)
            await session.flush()
            session.add(
                AgentRouting(
                    user_id=agent_user.id,
                    position=position,
                    handles=spec["handles"],
                    capacity=6,
                )
            )
            print(f"Created support agent {spec['full_name']}.")
        await session.commit()

        existing = await session.scalar(select(func.count()).select_from(SupportTicket))
        if existing:
            print(f"{existing} tickets already exist — leaving them alone.")
        else:
            for i, spec in enumerate(TICKETS):
                # Prefer the traveler actually planning that destination; fall back to anyone.
                match = next(
                    (
                        pair
                        for pair in planned
                        if spec.get("destination")
                        and (pair[1].state or {}).get("destination") == spec["destination"]
                    ),
                    None,
                )
                traveler, trip = match or planned[i % len(planned)]
                opened = datetime.now(UTC) - timedelta(hours=spec["hours_ago"])
                ticket = SupportTicket(
                    user_id=traveler.id,
                    session_id=trip.id if trip else None,
                    subject=spec["subject"],
                    status=spec["status"],
                    priority=spec["priority"],
                    channel=spec["channel"],
                    in_destination=spec.get("in_destination", False),
                    created_at=opened,
                    updated_at=opened,
                )
                if spec.get("reply"):
                    ticket.assignee_id = agent.id if agent else None
                    ticket.first_response_at = opened + timedelta(minutes=7)
                if spec["status"] == TicketStatus.RESOLVED:
                    ticket.resolved_at = opened + timedelta(hours=2)
                session.add(ticket)
                await session.flush()
                session.add(
                    SupportMessage(
                        ticket_id=ticket.id,
                        author=MessageAuthor.CUSTOMER,
                        body=spec["body"],
                        created_at=opened,
                    )
                )
                if spec.get("reply"):
                    session.add(
                        SupportMessage(
                            ticket_id=ticket.id,
                            author=MessageAuthor.AGENT,
                            author_id=agent.id if agent else None,
                            body=spec["reply"],
                            created_at=opened + timedelta(minutes=7),
                        )
                    )
            print(f"Created {len(TICKETS)} support tickets.")

        if await session.scalar(select(func.count()).select_from(MenuGroup)):
            print("Menus already exist — leaving them alone.")
        else:
            for position, spec in enumerate(MENUS, start=1):
                group = MenuGroup(
                    name=spec["name"],
                    slug=spec["name"].lower().replace(" ", "-"),
                    placement=spec["placement"],
                    position=position,
                )
                session.add(group)
                await session.flush()
                for i, item in enumerate(spec.get("items", []), start=1):
                    session.add(
                        MenuItem(
                            group_id=group.id, label=item["label"], url=item["url"], position=i
                        )
                    )
                for i, city_name in enumerate(spec.get("cities", []), start=1):
                    city = await session.scalar(
                        select(Location).where(
                            Location.name == city_name,
                            Location.type == LocationType.CITY,
                            Location.status == LocationStatus.PUBLISHED,
                        )
                    )
                    if city:
                        session.add(
                            MenuItem(
                                group_id=group.id,
                                label=city.name,
                                location_id=city.id,
                                position=i,
                            )
                        )
            print(f"Created {len(MENUS)} menus.")

        await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
