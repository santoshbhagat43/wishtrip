import re
import unicodedata
import uuid
from collections import Counter

from sqlalchemy import delete, func, or_, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.embeddings import get_embedder
from app.ai.indexing import stale_embedding_clause
from app.ai.llm import LLMClient
from app.core.config import settings
from app.core.errors import bad_request, conflict, not_found
from app.modules.audit.models import AuditLog
from app.modules.chat.models import ChatMessage, ChatSession
from app.modules.knowledge.models import (
    CONTAINER_TYPES,
    Location,
    LocationRelation,
    LocationStatus,
    LocationType,
    Tag,
    location_tags,
)
from app.modules.knowledge.schemas import (
    COMPLETENESS_FIELDS,
    CONTAINER_COMPLETENESS,
    DestinationRow,
    KnowledgeStats,
    LocationCreate,
    LocationListItem,
    LocationRead,
    LocationRef,
    LocationUpdate,
    RelationCreate,
    ReviewCheck,
    ReviewItem,
    ReviewQueue,
    ReviewReason,
    SystemStatus,
    TagCreate,
)
from app.modules.media.models import Media
from app.modules.users.models import Role, User

# Edits to these fields change what the AI should "know", so they trigger re-embedding.
EMBEDDED_FIELDS = {
    "name",
    "summary",
    "description",
    "tips",
    "pros",
    "cons",
    "tag_ids",
    "parent_id",
    "best_times",
    "seasons",
    "family_friendly",
    "couple_friendly",
    "energy_level",
    "status",
}


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "location"


async def _unique_slug(
    session: AsyncSession, name: str, exclude_id: uuid.UUID | None = None
) -> str:
    base = slugify(name)
    slug, n = base, 2
    while True:
        query = select(Location.id).where(Location.slug == slug)
        if exclude_id:
            query = query.where(Location.id != exclude_id)
        if not await session.scalar(query):
            return slug
        slug, n = f"{base}-{n}", n + 1


def completeness(location: Location) -> tuple[float, list[str]]:
    checks = (
        CONTAINER_COMPLETENESS if location.type in CONTAINER_TYPES else COMPLETENESS_FIELDS.keys()
    )
    missing = [
        label
        for label in checks
        if any(getattr(location, f) in (None, "", [], {}) for f in COMPLETENESS_FIELDS[label])
    ]
    return round(1 - len(missing) / len(checks), 2), missing


def to_list_item(location: Location) -> LocationListItem:
    item = LocationListItem.model_validate(location)
    item.completeness, item.missing_fields = completeness(location)
    return item


async def to_read(session: AsyncSession, location: Location) -> LocationRead:
    read = LocationRead.model_validate(location)
    read.completeness, read.missing_fields = completeness(location)
    read.ancestors = [LocationRef.model_validate(a) for a in await ancestors(session, location)]
    read.children_count = (
        await session.scalar(select(func.count()).where(Location.parent_id == location.id)) or 0
    )
    return read


async def ancestors(session: AsyncSession, location: Location) -> list[Location]:
    chain: list[Location] = []
    parent_id = location.parent_id
    while parent_id and len(chain) < 10:
        parent = await session.get(Location, parent_id)
        if parent is None:
            break
        chain.insert(0, parent)
        parent_id = parent.parent_id
    return chain


async def reload(session: AsyncSession, location: Location) -> Location:
    """Re-read a row with its eager relationships (parent, tags) so async code never lazy-loads."""
    fresh = await session.get(Location, location.id, populate_existing=True)
    assert fresh is not None
    return fresh


async def get(session: AsyncSession, location_id: uuid.UUID) -> Location:
    location = await session.get(Location, location_id)
    if not location:
        raise not_found("Location")
    return location


async def _validate_parent(
    session: AsyncSession, type_: LocationType, parent_id: uuid.UUID | None
) -> None:
    """Countries are roots, cities sit in a country, every other place sits in a city."""
    if type_ == LocationType.COUNTRY:
        if parent_id:
            raise bad_request("A country cannot have a parent")
        return
    if not parent_id:
        raise bad_request(f"A {type_} needs a parent location")
    parent = await get(session, parent_id)
    expected = LocationType.COUNTRY if type_ == LocationType.CITY else LocationType.CITY
    if parent.type != expected:
        raise bad_request(f"A {type_} must belong to a {expected}, not a {parent.type}")


async def _tags(session: AsyncSession, tag_ids: list[uuid.UUID]) -> list[Tag]:
    if not tag_ids:
        return []
    tags = list(await session.scalars(select(Tag).where(Tag.id.in_(tag_ids))))
    if len(tags) != len(set(tag_ids)):
        raise bad_request("One or more tags do not exist")
    return tags


async def create(session: AsyncSession, data: LocationCreate) -> Location:
    await _validate_parent(session, data.type, data.parent_id)
    location = Location(
        **data.model_dump(exclude={"tag_ids"}),
        slug=await _unique_slug(session, data.name),
        tags=await _tags(session, data.tag_ids),
    )
    session.add(location)
    await session.flush()
    return await reload(session, location)


async def update(session: AsyncSession, location: Location, data: LocationUpdate) -> set[str]:
    changes = data.model_dump(exclude_unset=True)
    if "parent_id" in changes:
        await _validate_parent(session, location.type, changes["parent_id"])
    if "tag_ids" in changes:
        location.tags = await _tags(session, changes.pop("tag_ids") or [])
    if "name" in changes and changes["name"] != location.name:
        location.slug = await _unique_slug(session, changes["name"], exclude_id=location.id)
    renamed = "name" in changes and changes["name"] != location.name
    for field, value in changes.items():
        setattr(location, field, value)
    await session.flush()
    await reload(session, location)
    return set(data.model_dump(exclude_unset=True)) | ({"_renamed"} if renamed else set())


async def child_ids(session: AsyncSession, location_id: uuid.UUID) -> list[uuid.UUID]:
    return list(await session.scalars(select(Location.id).where(Location.parent_id == location_id)))


def needs_embedding(location: Location, changed_fields: set[str]) -> bool:
    return location.status == LocationStatus.PUBLISHED and bool(changed_fields & EMBEDDED_FIELDS)


async def remove(session: AsyncSession, location: Location) -> None:
    has_children = await session.scalar(
        select(Location.id).where(Location.parent_id == location.id)
    )
    if has_children:
        raise conflict("Location has child locations; move or delete them first")
    await session.delete(location)


async def list_locations(
    session: AsyncSession,
    *,
    type_: list[LocationType] | None,
    parent_id: uuid.UUID | None,
    status: LocationStatus | None,
    q: str | None,
    tag_id: uuid.UUID | None,
    page: int,
    page_size: int,
    source: str | None = None,
    needs_verification: bool | None = None,
    region: str | None = None,
) -> tuple[list[Location], int]:
    query = select(Location)
    if source:
        query = query.where(Location.source == source)
    if region:
        query = query.where(Location.region.ilike(region))
    if needs_verification is not None:
        flag = Location.provenance["needs_verification"].as_boolean()
        query = query.where(flag.is_(True) if needs_verification else flag.isnot(True))
    if type_:
        query = query.where(Location.type.in_(type_))
    if parent_id:
        query = query.where(Location.parent_id == parent_id)
    if status:
        query = query.where(Location.status == status)
    if q:
        pattern = f"%{q}%"
        query = query.where(or_(Location.name.ilike(pattern), Location.summary.ilike(pattern)))
    if tag_id:
        query = query.where(Location.tags.any(Tag.id == tag_id))
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(
        query.order_by(Location.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    return list(rows.unique()), total


async def children_counts(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    rows = await session.execute(
        select(Location.parent_id, func.count())
        .where(Location.parent_id.in_(ids))
        .group_by(Location.parent_id)
    )
    return {parent_id: count for parent_id, count in rows.all()}


# Relations ---------------------------------------------------------------------------------


async def list_relations(session: AsyncSession, location_id: uuid.UUID) -> list[LocationRelation]:
    rows = await session.scalars(
        select(LocationRelation).where(
            or_(
                LocationRelation.source_id == location_id, LocationRelation.target_id == location_id
            )
        )
    )
    return list(rows.unique())


async def add_relation(
    session: AsyncSession, source: Location, data: RelationCreate
) -> LocationRelation:
    if data.target_id == source.id:
        raise bad_request("A location cannot relate to itself")
    await get(session, data.target_id)
    existing = await session.scalar(
        select(LocationRelation.id).where(
            LocationRelation.relation == data.relation,
            or_(
                (LocationRelation.source_id == source.id)
                & (LocationRelation.target_id == data.target_id),
                (LocationRelation.source_id == data.target_id)
                & (LocationRelation.target_id == source.id),
            ),
        )
    )
    if existing:
        raise conflict("This relationship already exists")
    relation = LocationRelation(source_id=source.id, **data.model_dump())
    session.add(relation)
    await session.flush()
    await session.refresh(relation)
    return relation


async def remove_relation(session: AsyncSession, relation_id: uuid.UUID) -> LocationRelation:
    relation = await session.get(LocationRelation, relation_id)
    if not relation:
        raise not_found("Relationship")
    await session.execute(delete(LocationRelation).where(LocationRelation.id == relation_id))
    return relation


# Tags --------------------------------------------------------------------------------------


async def list_tags(session: AsyncSession) -> list[Tag]:
    return list(await session.scalars(select(Tag).order_by(Tag.category, Tag.name)))


async def create_tag(session: AsyncSession, data: TagCreate) -> Tag:
    slug = slugify(data.name)
    if await session.scalar(select(Tag.id).where(Tag.slug == slug)):
        raise conflict("A tag with this name already exists")
    tag = Tag(name=data.name, slug=slug, category=data.category)
    session.add(tag)
    await session.flush()
    return tag


async def delete_tag(session: AsyncSession, tag_id: uuid.UUID) -> list[uuid.UUID]:
    """Delete a tag; returns the locations that carried it (their embedded text changed)."""
    tag = await session.get(Tag, tag_id)
    if not tag:
        raise not_found("Tag")
    affected = list(
        await session.scalars(
            select(location_tags.c.location_id).where(location_tags.c.tag_id == tag_id)
        )
    )
    await session.delete(tag)
    await touch(session, affected)
    return affected


async def touch(session: AsyncSession, location_ids: list[uuid.UUID]) -> None:
    """Bump updated_at so these rows read as stale for the search index."""
    if location_ids:
        await session.execute(
            sa_update(Location).where(Location.id.in_(location_ids)).values(updated_at=func.now())
        )


# Stats -------------------------------------------------------------------------------------


async def stats(session: AsyncSession) -> KnowledgeStats:
    by_type = dict(
        (await session.execute(select(Location.type, func.count()).group_by(Location.type))).all()
    )
    by_status = dict(
        (
            await session.execute(select(Location.status, func.count()).group_by(Location.status))
        ).all()
    )
    pending = await session.scalar(
        select(func.count()).where(
            Location.status == LocationStatus.PUBLISHED,
            stale_embedding_clause(get_embedder().name),
        )
    )
    locations = list(await session.scalars(select(Location)))
    incomplete = sum(1 for loc in locations if completeness(loc)[0] < 1)
    return KnowledgeStats(
        total=sum(by_type.values()),
        by_type={str(k): v for k, v in by_type.items()},
        by_status={str(k): v for k, v in by_status.items()},
        incomplete=incomplete,
        embeddings_pending=pending or 0,
        relations=await session.scalar(select(func.count()).select_from(LocationRelation)) or 0,
        tags=await session.scalar(select(func.count()).select_from(Tag)) or 0,
    )


def _review_checks(location: Location, missing: list[str], stale: bool) -> list[ReviewCheck]:
    """The automatic checks a reviewer sees before deciding. All derived from stored data."""
    has_coords = location.latitude is not None and location.longitude is not None
    return [
        ReviewCheck(ok=bool(location.summary), label="Has a summary"),
        ReviewCheck(ok=has_coords, label="Coordinates set"),
        ReviewCheck(
            ok=not location.provenance.get("needs_verification"),
            label="Verified by a person",
        ),
        ReviewCheck(
            ok=bool(location.price_note) or location.cost_level is not None,
            label="Price is verified or deliberately absent",
        ),
        ReviewCheck(ok=not missing, label="Has every field the AI plans from"),
        ReviewCheck(ok=not stale, label="Indexed for search and chat"),
    ]


def _review_reason(location: Location, missing: list[str], stale: bool) -> ReviewReason | None:
    """First reason that applies, so a record appears in exactly one queue.

    Verification comes before draft on purpose: an unverified import is waiting on a person to
    check it, and publishing it is the step after that, not a separate piece of work.
    """
    if location.status == LocationStatus.ARCHIVED:
        return None
    if location.provenance.get("needs_verification"):
        return ReviewReason.UNVERIFIED
    if location.status == LocationStatus.DRAFT:
        return ReviewReason.DRAFT
    if missing:
        return ReviewReason.INCOMPLETE
    if stale:
        return ReviewReason.STALE_INDEX
    return None


async def review_queue(
    session: AsyncSession,
    *,
    reason: ReviewReason | None = None,
    page: int = 1,
    page_size: int = 25,
) -> ReviewQueue:
    """Everything waiting for a human decision, grouped by why it's waiting.

    Counts cover the whole queue so the sidebar badge and the filters agree; `items` is the
    requested page of one reason (or of the whole queue when no reason is given).
    """
    stale_ids = set(
        await session.scalars(
            select(Location.id).where(
                Location.status == LocationStatus.PUBLISHED,
                stale_embedding_clause(get_embedder().name),
            )
        )
    )
    counts: dict[str, int] = {r.value: 0 for r in ReviewReason}
    by_field: dict[str, int] = {}
    queued: list[tuple[Location, ReviewReason, float, list[str]]] = []
    for location in await session.scalars(select(Location)):
        score, missing = completeness(location)
        why = _review_reason(location, missing, location.id in stale_ids)
        if why is None:
            continue
        counts[why.value] += 1
        if why == ReviewReason.INCOMPLETE:
            for field in missing:
                by_field[field] = by_field.get(field, 0) + 1
        queued.append((location, why, score, missing))

    selected = [row for row in queued if reason is None or row[1] == reason]
    # Oldest first: the longest-waiting record is the one a reviewer should see next.
    selected.sort(key=lambda row: row[0].updated_at)
    start = (page - 1) * page_size
    items = [
        ReviewItem(
            id=loc.id,
            type=loc.type,
            status=loc.status,
            name=loc.name,
            summary=loc.summary,
            parent=LocationRef.model_validate(loc.parent) if loc.parent else None,
            region=loc.region,
            source=loc.source,
            updated_at=loc.updated_at,
            embedded_at=loc.embedded_at,
            reason=why,
            completeness=score,
            missing_fields=missing,
            checks=_review_checks(loc, missing, loc.id in stale_ids),
            reference_keys=sorted(loc.reference.keys()),
        )
        for loc, why, score, missing in selected[start : start + page_size]
    ]
    return ReviewQueue(
        counts=counts,
        missing_by_field=dict(sorted(by_field.items(), key=lambda kv: -kv[1])),
        total=len(selected),
        oldest_updated_at=selected[0][0].updated_at if selected else None,
        items=items,
    )


# The sections of a city in the dashboard: everything that isn't a hotel or a place to eat is
# an experience (attractions, experiences, activities, routes).
SECTION_OF = {LocationType.HOTEL: "hotels", LocationType.RESTAURANT: "food"}


async def destinations(session: AsyncSession) -> list[DestinationRow]:
    """Cities with what the engine actually holds for them, busiest first."""
    cities = list(
        await session.scalars(
            select(Location).where(Location.type == LocationType.CITY).order_by(Location.name)
        )
    )
    children = list(
        await session.scalars(
            select(Location).where(Location.parent_id.in_([c.id for c in cities] or [None]))
        )
    )
    embedder = get_embedder().name
    # One trip count per destination name, matched against the chat session's resolved state.
    destination = func.lower(ChatSession.state["destination"].as_string())
    trips_by_name: dict[str, int] = dict(
        (
            await session.execute(
                select(destination, func.count())
                .where(destination.isnot(None))
                .group_by(destination)
            )
        ).all()
    )

    rows = []
    for city in cities:
        kids = [k for k in children if k.parent_id == city.id]
        published = [k for k in kids if k.status == LocationStatus.PUBLISHED]
        kinds = Counter(SECTION_OF.get(k.type, "experiences") for k in kids)
        rows.append(
            DestinationRow(
                id=city.id,
                name=city.name,
                status=city.status,
                region=city.region,
                country=city.parent.name if city.parent else "",
                country_id=city.parent_id,
                summary=city.summary,
                history_words=len((city.history or "").split()),
                hotels=kinds["hotels"],
                experiences=kinds["experiences"],
                food=kinds["food"],
                published=len(published),
                draft=sum(1 for k in kids if k.status == LocationStatus.DRAFT),
                incomplete=sum(1 for k in published if completeness(k)[1]),
                embedded=sum(
                    1 for k in published if k.embedded_at and k.embedding_model == embedder
                ),
                # Travelers name a city ("Munnar tea hills") or a region ("Kerala"). Region
                # demand belongs to the region, not to each of its cities, so keep them apart.
                trips=trips_by_name.get(city.name.lower(), 0),
                region_trips=trips_by_name.get(city.region.lower(), 0) if city.region else 0,
                updated_at=city.updated_at,
            )
        )
    rows.sort(key=lambda r: (-(r.trips + r.region_trips), -r.published, r.name))
    return rows


async def system_status(session: AsyncSession) -> SystemStatus:
    """What the stack is running right now — no estimates, all read from the live system."""
    embedder = get_embedder()
    stale = stale_embedding_clause(embedder.name)
    counts = {
        "locations": await session.scalar(select(func.count()).select_from(Location)) or 0,
        "published": await session.scalar(
            select(func.count()).where(Location.status == LocationStatus.PUBLISHED)
        )
        or 0,
        "relations": await session.scalar(select(func.count()).select_from(LocationRelation)) or 0,
        "tags": await session.scalar(select(func.count()).select_from(Tag)) or 0,
        "media": await session.scalar(select(func.count()).select_from(Media)) or 0,
        "travelers": await session.scalar(select(func.count()).where(User.role == Role.TRAVELER))
        or 0,
        "staff": await session.scalar(select(func.count()).where(User.role != Role.TRAVELER)) or 0,
        "chat_sessions": await session.scalar(select(func.count()).select_from(ChatSession)) or 0,
        "chat_messages": await session.scalar(select(func.count()).select_from(ChatMessage)) or 0,
    }
    llm = LLMClient()
    return SystemStatus(
        ai_enabled=llm.enabled,
        llm_provider=llm.provider,
        chat_model=llm.model_for("planner") if llm.enabled else "",
        intent_model=llm.model_for("intent") if llm.enabled else "",
        embedder=embedder.name,
        embedding_dimensions=settings.embedding_dimensions,
        embeddings_pending=await session.scalar(
            select(func.count()).where(Location.status == LocationStatus.PUBLISHED, stale)
        )
        or 0,
        oldest_stale_embed=await session.scalar(
            select(func.min(Location.updated_at)).where(
                Location.status == LocationStatus.PUBLISHED, stale
            )
        ),
        counts=counts,
        last_audit_at=await session.scalar(select(func.max(AuditLog.created_at))),
    )
