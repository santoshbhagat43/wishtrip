from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.modules.flights import service
from app.modules.flights.client import TripJackError, TripJackNotConfigured
from app.modules.flights.schemas import FareRuleQuery, FlightSearch
from app.modules.tripjack import trace
from app.modules.users.models import User

router = APIRouter(prefix="/flights", tags=["flights"])


def _supplier_error(exc: Exception) -> HTTPException:
    if isinstance(exc, TripJackNotConfigured):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Flight search is not set up yet")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Flight fares are not available right now")


@router.post("/search")
async def search(body: FlightSearch, _: User = Depends(get_current_user)):
    tr = trace.start()
    try:
        result = await service.search(body)
    except (TripJackError, TripJackNotConfigured) as exc:
        failure = _supplier_error(exc)
        failure.headers = await trace.explain(tr, exc)
        raise failure from exc
    return {**result, "supplier": await trace.finish(tr)}


@router.post("/fare-rules")
async def fare_rules(body: FareRuleQuery, _: User = Depends(get_current_user)):
    """Cancellation, date-change and no-show charges for a fare, by hours before departure."""
    tr = trace.start()
    try:
        result = await service.fare_rules(body)
    except (TripJackError, TripJackNotConfigured) as exc:
        failure = _supplier_error(exc)
        failure.headers = await trace.explain(tr, exc)
        raise failure from exc
    return {**result, "supplier": await trace.finish(tr)}
