"""Staff review of which TripJack hotel each creator-trip stay is (dashboard → Hotel matches)."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_staff
from app.core.pagination import Page
from app.db.session import get_session
from app.modules.creators.models import CreatorTrip
from app.modules.hotels import matching, photos
from app.modules.hotels.models import StayMatch, SupplierHotel
from app.modules.users.models import User

router = APIRouter(prefix="/hotel-matches", tags=["hotel-matches"])

State = Literal["matched", "review", "nomatch", "confirmed", "unlinked"]
STATES = ("review", "nomatch", "matched", "confirmed", "unlinked")


class HotelBrief(BaseModel):
    id: uuid.UUID
    tj_hotel_id: str
    name: str
    city: str = ""
    country: str = ""
    stars: float | None = None
    hero_image: str | None = None


class MatchRow(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    trip_title: str
    destination: str = ""
    share_code: str | None = None
    stay_name: str
    state: State
    score: float
    hotel: HotelBrief | None = None
    decided_by: str = ""


class MatchList(Page[MatchRow]):
    counts: dict[str, int]


class Candidate(BaseModel):
    hotel: HotelBrief
    score: float


class Choice(BaseModel):
    hotel_id: uuid.UUID


def brief(h: SupplierHotel) -> HotelBrief:
    return HotelBrief(
        id=h.id,
        tj_hotel_id=h.tj_hotel_id,
        name=h.name,
        city=h.city,
        country=h.country,
        stars=h.star_rating,
        hero_image=h.hero_image,
    )


async def _read(session: AsyncSession, row: StayMatch, trip: CreatorTrip) -> MatchRow:
    hotel = await session.get(SupplierHotel, row.hotel_id) if row.hotel_id else None
    # The name as the creator wrote it, when the stay is still in the trip.
    written = next(
        (i["name"] for i in trip.items or [] if str(i.get("id"))[:40] == row.item_id), ""
    )
    return MatchRow(
        id=row.id,
        trip_id=trip.id,
        trip_title=trip.title,
        destination=trip.destination_name,
        share_code=trip.share_code,
        stay_name=written or row.stay_name,
        state=row.state,  # type: ignore[arg-type]
        score=row.score,
        hotel=brief(hotel) if hotel else None,
        decided_by=row.decided_by,
    )


async def _get(session: AsyncSession, match_id: uuid.UUID) -> tuple[StayMatch, CreatorTrip]:
    row = await session.get(StayMatch, match_id)
    trip = await session.get(CreatorTrip, row.trip_id) if row else None
    if row is None or trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such stay match")
    return row, trip


@router.get("", response_model=MatchList)
async def list_matches(
    state: State | None = None,
    q: str | None = Query(None, description="Matches the stay, the trip or the hotel"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """Every stay in the creators' trips and the TripJack hotel it was matched to. Stays that
    have not been looked at yet are matched first."""
    trips = list((await session.scalars(select(CreatorTrip).limit(500))).all())
    for trip in trips:
        await photos.resolve(session, trip.id, list(trip.items or []), trip.destination_name)

    base = select(StayMatch, CreatorTrip).join(CreatorTrip, CreatorTrip.id == StayMatch.trip_id)
    base = base.outerjoin(SupplierHotel, SupplierHotel.id == StayMatch.hotel_id)
    by_state = await session.execute(
        select(StayMatch.state, func.count()).group_by(StayMatch.state)
    )
    counts = dict(by_state.all())
    if state:
        base = base.where(StayMatch.state == state)
    if q and q.strip():
        like = f"%{q.strip()}%"
        base = base.where(
            StayMatch.stay_name.ilike(like)
            | CreatorTrip.title.ilike(like)
            | CreatorTrip.destination_name.ilike(like)
            | SupplierHotel.name.ilike(like)
        )
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    order = case(*[(StayMatch.state == s, i) for i, s in enumerate(STATES)], else_=9)
    result = await session.execute(
        base.order_by(order, StayMatch.updated_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    items = [await _read(session, row, trip) for row, trip in result.all()]
    return MatchList(
        items=items,
        total=total or 0,
        page=page,
        page_size=page_size,
        counts={s: counts.get(s, 0) for s in STATES},
    )


@router.get("/{match_id}/candidates", response_model=list[Candidate])
async def candidates(
    match_id: uuid.UUID,
    q: str | None = Query(None, description="A hotel name to search for instead"),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """The likeliest TripJack hotels for this stay (or for what staff type), with their photos."""
    row, trip = await _get(session, match_id)
    found = await photos.ranked(
        session, row.stay_name, trip.destination_name, search=(q or "").strip() or None
    )
    return [Candidate(hotel=brief(h), score=s) for h, s in found]


@router.put("/{match_id}", response_model=MatchRow)
async def confirm(
    match_id: uuid.UUID,
    choice: Choice,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_staff),
):
    """Staff say this stay is this hotel. It is kept, whatever the creator later does."""
    row, trip = await _get(session, match_id)
    hotel = await session.get(SupplierHotel, choice.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such hotel")
    row.hotel_id, row.state, row.decided_by = hotel.id, "confirmed", user.email
    row.score = matching.score(row.stay_name, hotel.name, trip.destination_name)
    await session.commit()
    return await _read(session, row, trip)


@router.post("/{match_id}/unlink", response_model=MatchRow)
async def unlink(
    match_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_staff),
):
    """No TripJack hotel fits this stay: show nothing, and don't try again."""
    row, trip = await _get(session, match_id)
    row.hotel_id, row.state, row.score, row.decided_by = None, "unlinked", 0, user.email
    await session.commit()
    return await _read(session, row, trip)


@router.post("/{match_id}/reset", response_model=MatchRow)
async def reset(
    match_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """Forget a decision and match the stay by name again."""
    row, trip = await _get(session, match_id)
    item_id = row.item_id
    await session.delete(row)
    await session.commit()
    await photos.resolve(session, trip.id, list(trip.items or []), trip.destination_name)
    fresh = await session.scalar(
        select(StayMatch).where(StayMatch.trip_id == trip.id, StayMatch.item_id == item_id)
    )
    if fresh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That stay is no longer in the trip")
    return await _read(session, fresh, trip)
