import uuid
from collections import Counter

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_staff
from app.core.errors import bad_request, not_found
from app.core.pagination import Page
from app.db.session import get_session
from app.modules.creators import service, trips
from app.modules.creators.models import (
    AttributionEvent,
    AttributionSource,
    CommissionEntry,
    CommissionStatus,
    Creator,
    CreatorAttribution,
    CreatorStatus,
)
from app.modules.creators.schemas import (
    AttributionRead,
    CommissionRead,
    CommissionUpdate,
    CoverUpload,
    CreatorApplication,
    CreatorDetail,
    CreatorMe,
    CreatorOverview,
    CreatorProfileUpdate,
    CreatorRead,
    CreatorReel,
    CreatorStats,
    CreatorUpdate,
    ReferralRead,
    ReferralVisit,
)
from app.modules.media.storage import storage
from app.modules.reels.models import CreatorContent, ReelImport
from app.modules.users.models import Role, User

router = APIRouter(tags=["creators"])


async def _stats(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, CreatorStats]:
    stats = {i: CreatorStats() for i in ids}
    if not ids:
        return stats
    for creator_id, n in await session.execute(
        select(CreatorContent.creator_id, func.count())
        .where(CreatorContent.creator_id.in_(ids))
        .group_by(CreatorContent.creator_id)
    ):
        stats[creator_id].reels = n
    for creator_id, event, n in await session.execute(
        select(CreatorAttribution.creator_id, CreatorAttribution.event, func.count())
        .where(CreatorAttribution.creator_id.in_(ids))
        .group_by(CreatorAttribution.creator_id, CreatorAttribution.event)
    ):
        s = stats[creator_id]
        if event == AttributionEvent.REEL_IMPORT:
            s.reel_imports = n
        elif event == AttributionEvent.VISIT:
            s.link_visits = n
        elif event == AttributionEvent.TRIP_PLANNED:
            s.trips_planned = n
    for creator_id, n in await session.execute(
        select(User.referred_by_creator_id, func.count())
        .where(User.referred_by_creator_id.in_(ids))
        .group_by(User.referred_by_creator_id)
    ):
        stats[creator_id].credited_travellers = n
    amount = func.sum(CommissionEntry.amount_paise)
    for creator_id, state, total in await session.execute(
        select(CommissionEntry.creator_id, CommissionEntry.status, amount)
        .where(CommissionEntry.creator_id.in_(ids), CommissionEntry.status != CommissionStatus.VOID)
        .group_by(CommissionEntry.creator_id, CommissionEntry.status)
    ):
        stats[creator_id].earned_paise += total or 0
        if state == CommissionStatus.PAID:
            stats[creator_id].paid_paise += total or 0
    return stats


async def _read(session: AsyncSession, creator: Creator) -> CreatorRead:
    data = CreatorRead.model_validate(creator)
    data.stats = (await _stats(session, [creator.id]))[creator.id]
    return data


def _me(creator: Creator) -> CreatorMe:
    me = CreatorMe.model_validate(creator)
    me.avatar_url = storage.url(creator.avatar_key) if creator.avatar_key else None
    me.cover_url = storage.url(creator.cover_key) if creator.cover_key else None
    return me


async def _my_creator(session: AsyncSession, user: User) -> Creator:
    creator = await service.for_user(session, user.id)
    if not creator or user.role != Role.CREATOR:
        raise not_found("Creator")
    return creator


async def _set_photo(
    session: AsyncSession, user: User, field: str, data: CoverUpload | None
) -> CreatorMe:
    """Replace (or, with no upload, remove) the creator's profile or cover photo."""
    creator = await _my_creator(session, user)
    old = getattr(creator, field)
    new = (
        trips.save_image_upload(data.filename, data.data_base64, f"creator-pages/{creator.id}")
        if data
        else None
    )
    setattr(creator, field, new)
    await session.commit()
    if old:
        storage.delete(old)
    return _me(creator)


@router.patch("/creators/me", response_model=CreatorMe)
async def update_my_profile(
    data: CreatorProfileUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """A creator changes the name shown on their public page and on their trips."""
    creator = await _my_creator(session, user)
    name = " ".join(data.display_name.split())
    if len(name) < 2:
        raise bad_request("Enter the name you'd like to show.")
    creator.display_name = name
    await session.commit()
    return _me(creator)


@router.post("/creators/me/avatar", response_model=CreatorMe)
async def upload_my_avatar(
    data: CoverUpload,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await _set_photo(session, user, "avatar_key", data)


@router.post("/creators/me/cover", response_model=CreatorMe)
async def upload_my_cover(
    data: CoverUpload,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await _set_photo(session, user, "cover_key", data)


@router.delete("/creators/me/avatar", response_model=CreatorMe)
async def remove_my_avatar(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    return await _set_photo(session, user, "avatar_key", None)


@router.delete("/creators/me/cover", response_model=CreatorMe)
async def remove_my_cover(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    return await _set_photo(session, user, "cover_key", None)


@router.get("/creators/me", response_model=CreatorMe)
async def my_creator(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    """The signed-in creator's own account, so the website can show their approval state."""
    return _me(await _my_creator(session, user))


@router.get("/creators/me/overview", response_model=CreatorOverview)
async def my_overview(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    """The signed-in creator's dashboard: their numbers, reels, commissions and activity.

    Built from the same data as the staff view, but a creator never sees which travellers they
    brought in — every traveller email is dropped — and never sees staff notes.
    """
    creator = await _my_creator(session, user)
    detail = await _detail(session, creator)
    for row in (*detail.activity, *detail.commissions):
        row.user_email = None
    overview = CreatorOverview.model_validate(detail.model_dump(exclude={"notes"}))
    photos = _me(creator)
    overview.avatar_url, overview.cover_url = photos.avatar_url, photos.cover_url
    return overview


@router.get("/creators", response_model=Page[CreatorRead], dependencies=[Depends(require_staff)])
async def list_creators(
    status: CreatorStatus | None = None,
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    """Creators, newest first, a page at a time. `q` finds a creator by any part of their handle
    (with or without the @), name, email, WhatsApp number or YouTube channel."""
    query = select(Creator)
    if status is not None:
        query = query.where(Creator.status == status)
    term = (q or "").strip().lstrip("@")
    if term:
        # Search for the text itself: % and _ are not wildcards here.
        like = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(
            or_(
                *(
                    column.ilike(like, escape="\\")
                    for column in (
                        Creator.handle,
                        Creator.display_name,
                        Creator.email,
                        Creator.whatsapp,
                        Creator.youtube_url,
                    )
                )
            )
        )
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    creators = list(
        await session.scalars(
            query.order_by(Creator.created_at.desc(), Creator.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    stats = await _stats(session, [c.id for c in creators])
    out = []
    for c in creators:
        row = CreatorRead.model_validate(c)
        row.stats = stats[c.id]
        out.append(row)
    return Page(items=out, total=total, page=page, page_size=page_size)


async def _detail(session: AsyncSession, creator: Creator) -> CreatorDetail:
    base = await _read(session, creator)
    contents = list(
        await session.scalars(
            select(CreatorContent)
            .where(CreatorContent.creator_id == creator.id)
            .order_by(CreatorContent.created_at.desc())
        )
    )
    imports = Counter(
        dict(
            (
                await session.execute(
                    select(ReelImport.content_id, func.count())
                    .where(ReelImport.content_id.in_([c.id for c in contents]))
                    .group_by(ReelImport.content_id)
                )
            ).all()
        )
    )
    reels = [
        CreatorReel(
            shortcode=c.shortcode,
            url=c.url,
            thumbnail_url=storage.url(c.thumbnail_key) if c.thumbnail_key else None,
            destination_name=c.destination_name,
            summary=(c.extracted or {}).get("summary", ""),
            places=len(c.places or []),
            verified_places=sum(1 for p in c.places or [] if p.get("verified")),
            imports=imports[c.id],
            created_at=c.created_at,
        )
        for c in contents
    ]
    activity = [
        AttributionRead(
            id=a.id, event=a.event, source=a.source, user_email=email, created_at=a.created_at
        )
        for a, email in await session.execute(
            select(CreatorAttribution, User.email)
            .outerjoin(User, User.id == CreatorAttribution.user_id)
            .where(CreatorAttribution.creator_id == creator.id)
            .order_by(CreatorAttribution.created_at.desc())
            .limit(100)
        )
    ]
    commissions = [
        CommissionRead(
            id=e.id,
            user_email=email,
            event=e.event,
            amount_paise=e.amount_paise,
            status=e.status,
            created_at=e.created_at,
        )
        for e, email in await session.execute(
            select(CommissionEntry, User.email)
            .outerjoin(User, User.id == CommissionEntry.user_id)
            .where(CommissionEntry.creator_id == creator.id)
            .order_by(CommissionEntry.created_at.desc())
        )
    ]
    return CreatorDetail(
        **base.model_dump(), reels=reels, activity=activity, commissions=commissions
    )


async def _get(session: AsyncSession, creator_id: uuid.UUID) -> Creator:
    creator = await session.get(Creator, creator_id)
    if not creator:
        raise not_found("Creator")
    return creator


@router.get(
    "/creators/{creator_id}", response_model=CreatorDetail, dependencies=[Depends(require_staff)]
)
async def get_creator(creator_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    return await _detail(session, await _get(session, creator_id))


@router.patch(
    "/creators/{creator_id}", response_model=CreatorDetail, dependencies=[Depends(require_staff)]
)
async def update_creator(
    creator_id: uuid.UUID, data: CreatorUpdate, session: AsyncSession = Depends(get_session)
):
    creator = await _get(session, creator_id)
    for key, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(creator, key, value)
    await session.commit()
    await session.refresh(creator)
    return await _detail(session, creator)


@router.patch(
    "/creators/{creator_id}/commissions/{entry_id}",
    response_model=CreatorDetail,
    dependencies=[Depends(require_staff)],
)
async def update_commission(
    creator_id: uuid.UUID,
    entry_id: uuid.UUID,
    data: CommissionUpdate,
    session: AsyncSession = Depends(get_session),
):
    entry = await session.get(CommissionEntry, entry_id)
    if not entry or entry.creator_id != creator_id:
        raise not_found("Commission")
    entry.status = data.status
    await session.commit()
    return await _detail(session, await _get(session, creator_id))


# Public: the website's /c/<code> link ---------------------------------------------------------


@router.post("/creators/apply", status_code=202)
async def apply(data: CreatorApplication, session: AsyncSession = Depends(get_session)):
    """Public: a creator applies to join from the website's creator program page."""
    await service.apply_as_creator(
        session,
        email=data.email,
        name=data.name,
        handle=data.handle,
        youtube=data.youtube,
        whatsapp=data.whatsapp,
        followers=data.followers,
        posted_from=data.posted_from,
    )
    await session.commit()
    return {"ok": True}


@router.get("/referrals/{code}", response_model=ReferralRead)
async def read_referral(code: str, session: AsyncSession = Depends(get_session)):
    creator = await service.by_code(session, code)
    if not creator:
        raise not_found("Creator")
    return creator


@router.post("/referrals/{code}/visit", response_model=ReferralRead)
async def referral_visit(
    code: str, data: ReferralVisit, session: AsyncSession = Depends(get_session)
):
    creator = await service.by_code(session, code)
    if not creator:
        raise not_found("Creator")
    service.record(
        session,
        creator,
        AttributionEvent.VISIT,
        AttributionSource.REFERRAL_LINK,
        visitor_id=data.visitor_id,
    )
    await session.commit()
    return creator
