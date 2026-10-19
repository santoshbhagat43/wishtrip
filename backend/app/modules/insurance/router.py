from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.modules.insurance import service
from app.modules.insurance.client import TripJackError, TripJackNotConfigured
from app.modules.insurance.schemas import InsuranceSearch
from app.modules.tripjack import trace
from app.modules.users.models import User

router = APIRouter(prefix="/insurance", tags=["insurance"])


@router.post("/search")
async def search(body: InsuranceSearch, _: User = Depends(get_current_user)):
    """Travel-insurance plans (TripSafe) for a trip, cheapest first."""
    tr = trace.start()
    try:
        result = await service.search(body)
    except TripJackNotConfigured as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Travel insurance is not set up yet"
        ) from exc
    except TripJackError as exc:
        # 4xx from TripJack are about the request (blocked country, bad dates): say so.
        if exc.code.startswith("4") and exc.code not in {"401", "403", "412"}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.message) from exc
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Insurance plans are not available right now"
        ) from exc
    return {**result, "supplier": await trace.finish(tr)}
