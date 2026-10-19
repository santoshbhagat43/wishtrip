import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_staff
from app.db.session import SessionLocal, get_session
from app.modules.hotels import service
from app.modules.hotels.client import TripJackError, TripJackNotConfigured, tripjack_hotels
from app.modules.hotels.models import SupplierRegion
from app.modules.hotels.schemas import HotelPricing, HotelSearch
from app.modules.tripjack import trace
from app.modules.users.models import User

router = APIRouter(prefix="/hotels", tags=["hotels"])


def _supplier_error(exc: Exception) -> HTTPException:
    if isinstance(exc, TripJackNotConfigured):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Hotel search is not set up yet")
    if isinstance(exc, service.NoDestination):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Hotel prices are not available right now")


@router.get("/destinations")
async def destinations(
    q: str,
    limit: int = 10,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """City regions matching a name, biggest first. Pass a `region_id` to /hotels/search."""
    rows = (
        await session.execute(
            select(SupplierRegion)
            .where(func.lower(SupplierRegion.city_name).like(f"{q.strip().lower()}%"))
            .order_by(SupplierRegion.hotel_count.desc(), SupplierRegion.city_name)
            .limit(min(limit, 25))
        )
    ).scalars()
    return [
        {"region_id": r.region_id, "city": r.city_name, "country": r.country_name,
         "name": r.full_name}
        for r in rows
    ]


@router.post("/search")
async def search(
    body: HotelSearch,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
):
    tr = trace.start()
    try:
        result = await service.search(session, body)
    except (TripJackError, TripJackNotConfigured, service.NoDestination) as exc:
        failure = _supplier_error(exc)
        failure.headers = await trace.explain(tr, exc)
        raise failure from exc
    return {**result, "supplier": await trace.finish(tr)}


@router.post("/search/stream")
async def search_stream(body: HotelSearch, _: User = Depends(get_current_user)):
    """Server-sent events: one `data:` line per chunk of hotels as TripJack answers, so the first
    cards show in about a second instead of after the slowest chunk."""

    async def events() -> AsyncIterator[str]:
        # Its own session: the request's would be closed before the stream finishes.
        async with SessionLocal() as session:
            tr = trace.start()
            try:
                async for event in service.search_stream(session, body):
                    if event.get("done"):
                        event["supplier"] = await trace.finish(tr)
                    yield f"data: {json.dumps(event)}\n\n"
            except (TripJackError, TripJackNotConfigured, service.NoDestination) as exc:
                failure = {"error": _supplier_error(exc).detail, "trace_id": tr.id}
                await trace.finish(tr)
                yield f"data: {json.dumps(failure)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@router.post("/{hotel_id}/pricing")
async def pricing(
    hotel_id: str,
    body: HotelPricing,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
):
    tr = trace.start()
    try:
        result = await service.pricing(session, hotel_id, body)
    except (TripJackError, TripJackNotConfigured) as exc:
        failure = _supplier_error(exc)
        failure.headers = await trace.explain(tr, exc)
        raise failure from exc
    return {**result, "supplier": await trace.finish(tr)}


# ---- staff: catalogue sync ----


@router.post("/admin/sync/regions", status_code=status.HTTP_202_ACCEPTED)
async def sync_regions_now(_: User = Depends(require_staff)):
    from app.workers.tasks import sync_regions_task

    if not tripjack_hotels.configured:
        raise _supplier_error(TripJackNotConfigured())
    sync_regions_task.delay()
    return {"queued": "regions"}


@router.post("/admin/sync/regions/{region_id}", status_code=status.HTTP_202_ACCEPTED)
async def sync_region_now(region_id: int, _: User = Depends(require_staff)):
    from app.workers.tasks import sync_region_task

    if not tripjack_hotels.configured:
        raise _supplier_error(TripJackNotConfigured())
    sync_region_task.delay(region_id)
    return {"queued": region_id}
