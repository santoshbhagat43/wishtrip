"""Staff choose which creator trip is in the spotlight on the public Creator trips page."""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_staff
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.creators import public
from app.modules.creators.models import CreatorTrip

router = APIRouter(prefix="/spotlight", tags=["creators"], dependencies=[Depends(require_staff)])


class SpotlightTrip(BaseModel):
    trip_id: uuid.UUID
    title: str
    destination_name: str
    days: int
    stops: int
    cover_image_url: str | None = None
    creator_name: str
    # Their Instagram or YouTube handle, when staff have set it.
    creator_handle: str | None = None
    # How many published trips this creator has.
    creator_trips: int
    spotlight: bool


class SpotlightState(BaseModel):
    chosen_trip_id: uuid.UUID | None = None
    # Who the page shows when nothing is chosen (the creator with the most published trips).
    automatic_creator: str | None = None
    trips: list[SpotlightTrip]


class SpotlightChange(BaseModel):
    on: bool


async def _state(session: AsyncSession) -> SpotlightState:
    grouped = public.group(await public.eligible(session))
    auto = public.automatic(grouped)
    out: list[SpotlightTrip] = []
    for creator, creator_trips in grouped:
        for trip in creator_trips:
            card = public.trip_card(trip)
            out.append(
                SpotlightTrip(
                    trip_id=trip.id,
                    title=trip.title,
                    destination_name=trip.destination_name,
                    days=card.days,
                    stops=card.stops,
                    cover_image_url=card.cover_image_url,
                    creator_name=creator.display_name or creator.handle or "WishTrip creator",
                    creator_handle=(creator.handle or "").lstrip("@") or None,
                    creator_trips=len(creator_trips),
                    spotlight=trip.spotlight,
                )
            )
    # Featured first, then creators with the most trips, then the newest.
    out.sort(key=lambda t: (not t.spotlight, -t.creator_trips))
    chosen = next((t.trip_id for t in out if t.spotlight), None)
    automatic = auto[0] if auto else None
    return SpotlightState(
        chosen_trip_id=chosen,
        automatic_creator=(automatic.display_name or automatic.handle or "WishTrip creator")
        if automatic
        else None,
        trips=out,
    )


@router.get("", response_model=SpotlightState)
async def spotlight_state(session: AsyncSession = Depends(get_session)):
    """Every published trip that can be featured, and which one is."""
    return await _state(session)


@router.put("/trips/{trip_id}", response_model=SpotlightState)
async def set_spotlight(
    trip_id: uuid.UUID, data: SpotlightChange, session: AsyncSession = Depends(get_session)
):
    """Feature a published trip (its creator is shown with it) or take it off. One at a time."""
    trip = await session.get(CreatorTrip, trip_id)
    if trip is None:
        raise not_found("Trip")
    if data.on:
        shown = {t.id for _, t in await public.eligible(session)}
        if trip.id not in shown:
            raise bad_request(
                "Only a published trip by an approved creator can be featured."
            )
        await session.execute(
            update(CreatorTrip).where(CreatorTrip.id != trip.id).values(spotlight=False)
        )
    trip.spotlight = data.on
    await session.commit()
    return await _state(session)



