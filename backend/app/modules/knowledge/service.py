import re
import unicodedata
import uuid

from sqlalchemy import delete, func, or_, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.embeddings import get_embedder
from app.ai.indexing import stale_embedding_clause
from app.core.errors import bad_request, conflict, not_found
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
    KnowledgeStats,
    LocationCreate,
    LocationListItem,
    LocationRead,
    LocationRef,
    LocationUpdate,
    RelationCreate,
    TagCreate,
)

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
