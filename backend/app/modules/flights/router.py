from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user, require_staff
from app.modules.flights import booking, service
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


# --- Booking, for testing the TripJack API from the dashboard (UAT only, staff only) ------------


def _test_only() -> None:
    if not booking.is_test_environment():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Booking from the dashboard only works against TripJack's test environment",
        )


async def _call(work):
    _test_only()
    tr = trace.start()
    try:
        result = await work()
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except (TripJackError, TripJackNotConfigured) as exc:
        detail = exc.message if isinstance(exc, TripJackError) else "Flights are not set up yet"
        failure = HTTPException(status.HTTP_502_BAD_GATEWAY, f"TripJack: {detail}")
        failure.headers = await trace.explain(tr, exc)
        raise failure from exc
    return {**result, "supplier": await trace.finish(tr)}


@router.post("/review")
async def review(body: booking.ReviewQuery, _: User = Depends(require_staff)):
    """Check a fare again with TripJack: its total now, whether it can be held, how long the
    review stays good, and what the booking form needs (PAN, passport, dates of birth, GST)."""
    return await _call(lambda: booking.review(body))


@router.post("/book")
async def book(body: booking.BookQuery, _: User = Depends(require_staff)):
    """Hold the reviewed fare (no payment) or book it outright. Sent to TripJack once."""
    return await _call(lambda: booking.book(body))


@router.get("/bookings/{booking_id}")
async def booking_details(booking_id: str, _: User = Depends(require_staff)):
    """The booking as TripJack has it: status, PNRs, tickets and when a hold runs out."""
    return await _call(lambda: booking.details(booking_id))


@router.post("/bookings/{booking_id}/confirm")
async def confirm_hold(
    booking_id: str, body: booking.ConfirmQuery, _: User = Depends(require_staff)
):
    """Ticket a held booking (TripJack re-checks the fare first)."""
    return await _call(lambda: booking.confirm(booking_id, body))


@router.post("/bookings/{booking_id}/release")
async def release_hold(
    booking_id: str, body: booking.ReleaseQuery, _: User = Depends(require_staff)
):
    """Give up a hold: TripJack releases the PNR and the booking becomes UNCONFIRMED."""
    return await _call(lambda: booking.release(booking_id, body))
