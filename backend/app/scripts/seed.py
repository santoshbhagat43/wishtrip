"""Seed a starter knowledge base, an admin and a demo traveler. Safe to run repeatedly.

    docker compose exec backend python -m app.scripts.seed

Seeded places are *sample content for the team to review*. No prices are seeded on
purpose: WishTrip never shows a price it has not verified.
"""

import asyncio
import os

from sqlalchemy import select

from app.ai.indexing import embed_locations
from app.ai.orchestrator import AIOrchestrator
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.modules.knowledge.models import (
    Location,
    LocationRelation,
    LocationStatus,
    LocationType,
    RelationType,
    Tag,
    TagCategory,
)
from app.modules.knowledge.service import slugify
from app.modules.profiles.models import Companions, TravelerProfile
from app.modules.users.models import Role, User

TAGS = {
    TagCategory.INTEREST: [
        "History",
        "Architecture",
        "Scenic views",
        "Street food",
        "Fine dining",
        "Museums",
        "Nightlife",
        "Nature",
        "Shopping",
        "Photography",
        "Art",
        "Markets",
    ],
    TagCategory.STYLE: ["Romantic", "Relaxed", "Adventure", "Local life", "Family fun"],
    TagCategory.CUISINE: ["British", "French", "Vegetarian friendly"],
}

P = LocationType
PLACES: list[dict] = [
    {
        "type": P.COUNTRY,
        "name": "United Kingdom",
        "summary": "England, Scotland, Wales and Northern Ireland.",
        "latitude": 54.0,
        "longitude": -2.0,
    },
    {
        "type": P.COUNTRY,
        "name": "France",
        "summary": "Art, food and countryside in western Europe.",
        "latitude": 46.6,
        "longitude": 2.2,
    },
    {
        "type": P.CITY,
        "name": "London",
        "parent": "United Kingdom",
        "summary": "Historic capital on the Thames with world-class museums and markets.",
        "description": "London mixes royal history, riverside walks, free museums and a huge food scene.",
        "latitude": 51.5072,
        "longitude": -0.1276,
    },
    {
        "type": P.CITY,
        "name": "Paris",
        "parent": "France",
        "summary": "The French capital of art, cafés and grand boulevards.",
        "description": "Paris rewards slow wandering: museums, bakeries, the Seine and lively neighbourhoods.",
        "latitude": 48.8566,
        "longitude": 2.3522,
    },
    # London
    {
        "type": P.ATTRACTION,
        "name": "Tower Bridge",
        "parent": "London",
        "summary": "Victorian bascule bridge with a glass-floor walkway.",
        "description": "Iconic bridge over the Thames. The exhibition includes high-level walkways with glass floors and the Victorian engine rooms.",
        "latitude": 51.5055,
        "longitude": -0.0754,
        "duration_minutes": 90,
        "best_times": ["morning", "evening"],
        "energy_level": 2,
        "difficulty": 1,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": True,
        "pros": ["Great river views", "Easy to combine with the Tower of London"],
        "cons": ["Busy at midday in summer"],
        "tips": "Walk across at dusk for the lights.",
        "tags": ["History", "Architecture", "Scenic views", "Photography"],
    },
    {
        "type": P.ATTRACTION,
        "name": "Westminster",
        "parent": "London",
        "summary": "Parliament, Big Ben and Westminster Abbey in one walkable area.",
        "description": "The political heart of the UK. Walk from Westminster Bridge past the Houses of Parliament to the Abbey.",
        "latitude": 51.4995,
        "longitude": -0.1248,
        "duration_minutes": 150,
        "best_times": ["morning", "afternoon"],
        "energy_level": 3,
        "difficulty": 2,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": True,
        "pros": ["Many landmarks within a short walk"],
        "cons": ["Crowded around Big Ben"],
        "tags": ["History", "Architecture", "Photography"],
    },
    {
        "type": P.EXPERIENCE,
        "name": "Thames River Cruise",
        "parent": "London",
        "summary": "See the city's landmarks from the water.",
        "description": "A relaxed boat trip between Westminster and Greenwich passing the Tower, St Paul's and the Shard.",
        "latitude": 51.5014,
        "longitude": -0.1219,
        "duration_minutes": 60,
        "best_times": ["afternoon", "evening"],
        "energy_level": 1,
        "difficulty": 1,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": True,
        "pros": ["Restful way to sightsee", "Good in light rain"],
        "cons": ["Views depend on the weather"],
        "tags": ["Scenic views", "Relaxed", "Romantic"],
    },
    {
        "type": P.EXPERIENCE,
        "name": "Borough Market Food Walk",
        "parent": "London",
        "summary": "Graze through London's oldest food market.",
        "description": "Self-guided tasting walk through Borough Market's stalls: cheese, bakeries, street food and coffee.",
        "latitude": 51.5055,
        "longitude": -0.0910,
        "duration_minutes": 120,
        "best_times": ["morning", "afternoon"],
        "energy_level": 2,
        "difficulty": 1,
        "family_friendly": True,
        "couple_friendly": True,
        "pros": ["Huge variety of food", "Central location"],
        "cons": ["Very busy on Saturdays"],
        "tips": "Go on a weekday late morning.",
        "tags": ["Street food", "Markets", "Local life", "Vegetarian friendly"],
    },
    {
        "type": P.ATTRACTION,
        "name": "Sky Garden",
        "parent": "London",
        "summary": "Indoor garden with panoramic views at the top of a skyscraper.",
        "latitude": 51.5113,
        "longitude": -0.0835,
        "duration_minutes": 60,
        "best_times": ["evening"],
        "energy_level": 1,
        "difficulty": 1,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": True,
        "pros": ["Free entry with advance booking", "Sunset views"],
        "cons": ["Slots go quickly"],
        "tags": ["Scenic views", "Romantic", "Photography"],
    },
    {
        "type": P.ROUTE,
        "name": "South Bank Riverside Walk",
        "parent": "London",
        "summary": "Flat riverside walk from the London Eye to Tower Bridge.",
        "latitude": 51.5045,
        "longitude": -0.1100,
        "duration_minutes": 120,
        "best_times": ["afternoon", "evening"],
        "energy_level": 3,
        "difficulty": 2,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": True,
        "pros": ["Street performers and book market", "Many food stops"],
        "tags": ["Scenic views", "Local life", "Photography"],
    },
    {
        "type": P.HOTEL,
        "name": "Sample Riverside Hotel (placeholder)",
        "parent": "London",
        "summary": "Placeholder hotel entry — replace with a real partner property.",
        "latitude": 51.5040,
        "longitude": -0.0860,
        "family_friendly": True,
        "couple_friendly": True,
        "status": LocationStatus.DRAFT,
    },
    # Paris
    {
        "type": P.ATTRACTION,
        "name": "Louvre Museum",
        "parent": "Paris",
        "summary": "The world's largest art museum, home of the Mona Lisa.",
        "latitude": 48.8606,
        "longitude": 2.3376,
        "duration_minutes": 240,
        "best_times": ["morning"],
        "energy_level": 3,
        "difficulty": 2,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": True,
        "pros": ["Unmatched collection"],
        "cons": ["Long queues without a timed ticket"],
        "tips": "Pick two or three wings rather than trying to see everything.",
        "tags": ["Art", "Museums", "History"],
    },
    {
        "type": P.ATTRACTION,
        "name": "Montmartre",
        "parent": "Paris",
        "summary": "Hilltop artists' quarter crowned by the Sacré-Cœur.",
        "latitude": 48.8867,
        "longitude": 2.3431,
        "duration_minutes": 180,
        "best_times": ["morning", "evening"],
        "energy_level": 4,
        "difficulty": 3,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": False,
        "pros": ["Views over Paris", "Village atmosphere"],
        "cons": ["Steep steps"],
        "tags": ["Art", "Scenic views", "Romantic", "Local life"],
    },
    {
        "type": P.EXPERIENCE,
        "name": "Seine Evening Cruise",
        "parent": "Paris",
        "summary": "Glide past illuminated monuments after dark.",
        "latitude": 48.8584,
        "longitude": 2.2945,
        "duration_minutes": 70,
        "best_times": ["evening", "night"],
        "energy_level": 1,
        "difficulty": 1,
        "family_friendly": True,
        "couple_friendly": True,
        "accessible": True,
        "pros": ["Eiffel Tower sparkle on the hour"],
        "tags": ["Romantic", "Scenic views", "Relaxed"],
    },
]

RELATIONS = [
    ("Tower Bridge", "Borough Market Food Walk", RelationType.NEAR, 15),
    ("Tower Bridge", "Sky Garden", RelationType.NEAR, 15),
    ("Westminster", "Thames River Cruise", RelationType.PAIRS_WITH, 5),
    ("South Bank Riverside Walk", "Tower Bridge", RelationType.ROUTE_TO, 0),
    ("Borough Market Food Walk", "South Bank Riverside Walk", RelationType.PAIRS_WITH, 5),
    ("Louvre Museum", "Seine Evening Cruise", RelationType.PAIRS_WITH, 20),
]


async def seed() -> None:
    async with SessionLocal() as session:
        admin_email = os.environ.get("ADMIN_EMAIL")
        admin_password = os.environ.get("ADMIN_PASSWORD")
        if (
            admin_email
            and admin_password
            and not await session.scalar(select(User).where(User.email == admin_email.lower()))
        ):
            session.add(
                User(
                    email=admin_email.lower(),
                    hashed_password=hash_password(admin_password),
                    full_name="WishTrip Admin",
                    role=Role.ADMIN,
                )
            )

        tags: dict[str, Tag] = {t.name: t for t in await session.scalars(select(Tag))}
        for category, names in TAGS.items():
            for name in names:
                if name not in tags:
                    tags[name] = Tag(name=name, slug=slugify(name), category=category)
                    session.add(tags[name])
        await session.flush()

        locations: dict[str, Location] = {
            loc.name: loc for loc in (await session.scalars(select(Location))).unique()
        }
        for spec in PLACES:
            spec = dict(spec)
            if spec["name"] in locations:
                continue
            parent = spec.pop("parent", None)
            tag_names = spec.pop("tags", [])
            location = Location(
                **{"status": LocationStatus.PUBLISHED, **spec},
                slug=slugify(spec["name"]),
                parent_id=locations[parent].id if parent else None,
                tags=[tags[n] for n in tag_names],
            )
            session.add(location)
            await session.flush()
            locations[location.name] = location

        for source, target, relation, minutes in RELATIONS:
            exists = await session.scalar(
                select(LocationRelation.id).where(
                    LocationRelation.source_id == locations[source].id,
                    LocationRelation.target_id == locations[target].id,
                    LocationRelation.relation == relation,
                )
            )
            if not exists:
                session.add(
                    LocationRelation(
                        source_id=locations[source].id,
                        target_id=locations[target].id,
                        relation=relation,
                        travel_minutes=minutes,
                    )
                )

        traveler_email = os.environ.get("DEMO_TRAVELER_EMAIL")
        traveler_password = os.environ.get("DEMO_TRAVELER_PASSWORD")
        if (
            traveler_email
            and traveler_password
            and not await session.scalar(select(User).where(User.email == traveler_email.lower()))
        ):
            traveler = User(
                email=traveler_email.lower(),
                hashed_password=hash_password(traveler_password),
                full_name="Demo Traveler",
                role=Role.TRAVELER,
            )
            session.add(traveler)
            await session.flush()
            session.add(
                TravelerProfile(
                    user_id=traveler.id,
                    budget_level=2,
                    energy_level=2,
                    companions=Companions.COUPLE,
                    travel_styles=["relaxed", "romantic"],
                    food_preferences=["street food"],
                    preferred_times=["afternoon", "evening"],
                    interest_tag_ids=[tags["Scenic views"].id, tags["Street food"].id],
                )
            )
        await session.commit()

        count = await embed_locations(session, AIOrchestrator())
        print(f"Seed complete. Embedded {count} locations.")


if __name__ == "__main__":
    asyncio.run(seed())
