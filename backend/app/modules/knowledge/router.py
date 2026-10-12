import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.scheduling import schedule_embedding
from app.core.deps import require_staff
from app.core.pagination import Page
from app.db.session import get_session
from app.modules.audit.service import record
from app.modules.knowledge import service
from app.modules.knowledge.models import LocationStatus, LocationType
from app.modules.knowledge.schemas import (
    DestinationRow,
    KnowledgeStats,
    LocationCreate,
    LocationListItem,
    LocationRead,
    LocationUpdate,
    RelationCreate,
    RelationRead,
    ReviewQueue,
    ReviewReason,
    SystemStatus,
    TagCreate,
    TagRead,
)
from app.modules.users.models import User

router = APIRouter(prefix="/admin", tags=["knowledge"])


@router.get("/stats", response_model=KnowledgeStats)
async def knowledge_stats(
    session: AsyncSession = Depends(get_session), _: User = Depends(require_staff)
):
    return await service.stats(session)


@router.get("/review-queue", response_model=ReviewQueue)
async def review_queue(
    reason: ReviewReason | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """Everything waiting for a person: drafts, unverified imports, gaps, stale indexes."""
    return await service.review_queue(session, reason=reason, page=page, page_size=page_size)


@router.get("/destinations", response_model=list[DestinationRow])
async def destinations(
    session: AsyncSession = Depends(get_session), _: User = Depends(require_staff)
):
    """Every city with what the engine holds for it, and how often travelers ask for it."""
    return await service.destinations(session)


@router.get("/system", response_model=SystemStatus)
async def system_status(
    session: AsyncSession = Depends(get_session), _: User = Depends(require_staff)
):
    """Live provider, model, index and volume figures for the System health screen."""
    return await service.system_status(session)


@router.get("/locations", response_model=Page[LocationListItem])
async def list_locations(
    type: list[LocationType] | None = Query(None),
    parent_id: uuid.UUID | None = None,
    status: LocationStatus | None = None,
    q: str | None = None,
    tag_id: uuid.UUID | None = None,
    source: str | None = None,
    needs_verification: bool | None = None,
    region: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    rows, total = await service.list_locations(
        session,
        type_=type,
        parent_id=parent_id,
        status=status,
        q=q,
        tag_id=tag_id,
        page=page,
        page_size=page_size,
        source=source,
        needs_verification=needs_verification,
        region=region,
    )
    return Page(
        items=[service.to_list_item(r) for r in rows], total=total, page=page, page_size=page_size
    )


@router.get("/locations/{location_id}/children-counts", response_model=dict[uuid.UUID, int])
async def children_counts(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """Child counts for each direct child of a location (used by the hierarchy tree)."""
    rows, _total = await service.list_locations(
        session,
        type_=None,
        parent_id=location_id,
        status=None,
        q=None,
        tag_id=None,
        page=1,
        page_size=1000,
    )
    return await service.children_counts(session, [r.id for r in rows])


@router.post("/locations", response_model=LocationRead, status_code=201)
async def create_location(
    data: LocationCreate,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    location = await service.create(session, data)
    await record(session, actor, "create", "location", location.id, data.model_dump())
    await session.commit()
    if location.status == LocationStatus.PUBLISHED:
        background.add_task(schedule_embedding, [location.id])
    return await service.to_read(session, location)


@router.get("/locations/{location_id}", response_model=LocationRead)
async def get_location(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    return await service.to_read(session, await service.get(session, location_id))


@router.patch("/locations/{location_id}", response_model=LocationRead)
async def update_location(
    location_id: uuid.UUID,
    data: LocationUpdate,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    location = await service.get(session, location_id)
    changed = await service.update(session, location, data)
    # Children's embedded text includes their parent's name.
    children = await service.child_ids(session, location.id) if "_renamed" in changed else []
    await service.touch(session, children)
    changed.discard("_renamed")
    await record(
        session, actor, "update", "location", location.id, data.model_dump(exclude_unset=True)
    )
    await session.commit()
    to_embed = ([location.id] if service.needs_embedding(location, changed) else []) + children
    if to_embed:
        background.add_task(schedule_embedding, to_embed)
    return await service.to_read(session, location)


@router.delete("/locations/{location_id}", status_code=204)
async def delete_location(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    location = await service.get(session, location_id)
    await service.remove(session, location)
    await record(session, actor, "delete", "location", location_id, {"name": location.name})
    await session.commit()
    return Response(status_code=204)


@router.post("/locations/reindex", status_code=202)
async def reindex_locations(
    background: BackgroundTasks, _: User = Depends(require_staff)
) -> dict[str, str]:
    """Re-embed every published location whose embedding is missing or out of date."""
    background.add_task(schedule_embedding, None)
    return {"status": "queued"}


@router.get("/locations/{location_id}/relations", response_model=list[RelationRead])
async def list_relations(
    location_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    return await service.list_relations(session, location_id)


@router.post("/locations/{location_id}/relations", response_model=RelationRead, status_code=201)
async def add_relation(
    location_id: uuid.UUID,
    data: RelationCreate,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    source = await service.get(session, location_id)
    relation = await service.add_relation(session, source, data)
    await record(session, actor, "create", "relation", relation.id, data.model_dump())
    await session.commit()
    return relation


@router.delete("/relations/{relation_id}", status_code=204)
async def delete_relation(
    relation_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    relation = await service.remove_relation(session, relation_id)
    await record(session, actor, "delete", "relation", relation_id, {"relation": relation.relation})
    await session.commit()
    return Response(status_code=204)


@router.get("/tags", response_model=list[TagRead])
async def list_tags(session: AsyncSession = Depends(get_session), _: User = Depends(require_staff)):
    return await service.list_tags(session)


@router.post("/tags", response_model=TagRead, status_code=201)
async def create_tag(
    data: TagCreate,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    tag = await service.create_tag(session, data)
    await record(session, actor, "create", "tag", tag.id, data.model_dump())
    await session.commit()
    return tag


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: uuid.UUID,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(require_staff),
):
    affected = await service.delete_tag(session, tag_id)
    await record(session, actor, "delete", "tag", tag_id, {"locations": len(affected)})
    await session.commit()
    if affected:
        background.add_task(schedule_embedding, affected)
    return Response(status_code=204)
