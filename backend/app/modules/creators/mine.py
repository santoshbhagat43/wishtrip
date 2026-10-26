"""Make it mine: a traveller shapes a creator's published trip around themselves (who is going,
how many days, the pace) and keeps it under a short code, to come back to and change."""

import secrets

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.creators import trips
from app.modules.creators.models import Creator, CreatorTrip, TravellerTrip, TripStatus
from app.modules.creators.schemas import PublicCreator, TripItem
from app.modules.hotels import photos
from app.modules.media.storage import storage

router = APIRouter(tags=["trips"])

PACES = ("relaxed", "balanced", "packed")
# No 0/O/1/I/L: a code read out or typed from a message stays unambiguous.
ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


class MineConfig(BaseModel):
    adults: int = Field(default=2, ge=0, le=9)
    kids: int = Field(default=0, ge=0, le=9)
    seniors: int = Field(default=0, ge=0, le=9)
    days: int = Field(default=4, ge=1, le=7)
    pace: str = "relaxed"
    when: str = Field(default="", max_length=80)


class MineRead(BaseModel):
    code: str
    source_share_code: str
    title: str
    destination_name: str
    summary: str
    cover_image_url: str | None = None
    creator: PublicCreator
    items: list[TripItem]
    adults: int
    kids: int
    seniors: int
    days: int
    pace: str
    when: str


def _check(config: MineConfig) -> None:
    if config.adults + config.kids + config.seniors < 1:
        raise bad_request("Add at least one traveller.")
    if config.pace not in PACES:
        raise bad_request("Pace is relaxed, balanced or packed.")


async def _unique_code(session: AsyncSession) -> str:
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(8))
        if not await session.scalar(select(exists().where(TravellerTrip.code == code))):
            return code


async def _read(session: AsyncSession, mine: TravellerTrip) -> MineRead:
    items, _ = await photos.attach(session, list(mine.items or []))
    return MineRead(
        code=mine.code,
        source_share_code=mine.source_share_code,
        title=mine.title,
        destination_name=mine.destination_name,
        summary=mine.summary,
        cover_image_url=storage.url(mine.cover_image_key) if mine.cover_image_key else None,
        creator=PublicCreator(
            handle=mine.creator_handle,
            display_name=mine.creator_name or mine.creator_handle or "A wishtrip creator",
            referral_code=mine.creator_referral_code,
        ),
        items=[TripItem(**i) for i in items],
        adults=mine.adults,
        kids=mine.kids,
        seniors=mine.seniors,
        days=mine.days,
        pace=mine.pace,
        when=mine.when_text,
    )


def _apply(mine: TravellerTrip, config: MineConfig) -> None:
    mine.adults, mine.kids, mine.seniors = config.adults, config.kids, config.seniors
    mine.days, mine.pace = config.days, config.pace
    mine.when_text = " ".join(config.when.split())


@router.post("/trips/{share_code}/make-mine", response_model=MineRead, status_code=201)
async def make_mine(
    share_code: str, config: MineConfig, session: AsyncSession = Depends(get_session)
):
    """Public: copy a published creator trip for this traveller, with their details. Returns the
    code to come back to."""
    _check(config)
    trip = await session.scalar(select(CreatorTrip).where(CreatorTrip.share_code == share_code))
    if not trip or trip.status != TripStatus.PUBLISHED:
        raise not_found("Trip")
    creator = await session.get(Creator, trip.creator_id)
    assert creator is not None
    mine = TravellerTrip(
        code=await _unique_code(session),
        source_trip_id=trip.id,
        source_share_code=share_code,
        title=trip.title,
        destination_name=trip.destination_name,
        summary=trip.summary,
        cover_image_key=trip.cover_image_key,
        creator_name=creator.display_name or (creator.handle or ""),
        creator_handle=creator.handle,
        creator_referral_code=creator.referral_code,
        items=trips.clean_items(trip.items or []),
    )
    _apply(mine, config)
    session.add(mine)
    await session.commit()
    return await _read(session, mine)


async def _get(session: AsyncSession, code: str) -> TravellerTrip:
    mine = await session.scalar(
        select(TravellerTrip).where(TravellerTrip.code == code.strip().lower())
    )
    if not mine:
        raise not_found("Trip")
    return mine


@router.get("/my-trips/{code}", response_model=MineRead)
async def read_mine(code: str, session: AsyncSession = Depends(get_session)):
    """Public (the code is the key): a trip made for a traveller, as they left it."""
    return await _read(session, await _get(session, code))


@router.patch("/my-trips/{code}", response_model=MineRead)
async def update_mine(
    code: str, config: MineConfig, session: AsyncSession = Depends(get_session)
):
    """Change who is going, the days, the pace or the dates; the code stays the same."""
    _check(config)
    mine = await _get(session, code)
    _apply(mine, config)
    await session.commit()
    return await _read(session, mine)
