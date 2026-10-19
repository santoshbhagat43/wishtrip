from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import require_staff
from app.modules.tripjack import trace
from app.modules.users.models import User

router = APIRouter(prefix="/tripjack", tags=["tripjack"])


@router.get("/evidence/{trace_id}")
async def evidence(trace_id: str, _: User = Depends(require_staff)):
    """What TripJack really returned for the request that carried this `supplier.trace_id`:
    each call (host, status, timing) and a compact copy of the values it sent (hotel ids, names,
    prices, fare ids). For checking that what we show is what TripJack said. Kept for an hour;
    the API key is never recorded."""
    found = await trace.load(trace_id)
    if found is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No record of that request (kept for an hour)"
        )
    return found
