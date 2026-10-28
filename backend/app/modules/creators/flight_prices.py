"""Live TripJack flight price for a traveller's trip: from their city to the destination on the
start date, and back on the last day, for the whole party. From TripJack's answer only: with no
date, no from-city or no known airport it says so, and is never given a number of ours."""

import datetime as dt
import logging
from datetime import datetime

from pydantic import BaseModel

from app.core.config import settings
from app.modules.creators import builder
from app.modules.creators.models import TravellerTrip
from app.modules.creators.stay_prices import IST
from app.modules.flights import service
from app.modules.flights.airports import airport_for
from app.modules.flights.client import TripJackError, TripJackNotConfigured, tripjack_flights
from app.modules.flights.schemas import FlightSearch, Leg
from app.modules.tripjack.cache import cache_get, cache_key, cache_set

log = logging.getLogger(__name__)

FRESH_SECONDS = 300


class FlightLeg(BaseModel):
    from_code: str
    to_code: str
    date: dt.date
    airline: str = ""
    flight_number: str = ""
    departs: str | None = None
    arrives: str | None = None
    stops: int = 0
    price: float | None = None


class FlightPrice(BaseModel):
    # priced · unavailable (no fare found) · no_dates · no_origin · no_airport · same_city · error
    status: str
    origin: str = ""
    destination: str = ""
    adults: int = 0
    children: int = 0
    legs: list[FlightLeg] = []
    total: float | None = None
    checked_at: str | None = None


def _leg(trip: dict, a: str, b: str, day: dt.date) -> FlightLeg:
    first = trip["legs"][0][0] if trip.get("legs") and trip["legs"][0] else {}
    return FlightLeg(
        from_code=a, to_code=b, date=day,
        airline=(trip["airlines"][0]["name"] if trip.get("airlines") else ""),
        flight_number=first.get("flight_number", ""),
        departs=trip.get("departs"), arrives=trip.get("arrives"), stops=trip.get("stops", 0),
        price=trip["cheapest"]["price"]["total"],
    )


def _cheapest(flights: list[dict], journey: str) -> dict | None:
    pool = [f for f in flights if f["journey"] == journey]
    return min(pool, key=lambda f: f["cheapest"]["price"]["total"]) if pool else None


async def _one_way(
    origin: str, destination: str, day: dt.date, party: int, kids: int
) -> FlightLeg | None:
    found = (await service.search(FlightSearch(
        legs=[Leg(origin=origin, destination=destination, date=day)], adults=party, children=kids,
    )))["flights"]
    best = _cheapest(found, "ONWARD")
    return _leg(best, origin, destination, day) if best else None


async def _open_jaw(
    base: FlightPrice, mine: TravellerTrip, dest: str, leave: str, start: dt.date, end: dt.date,
    party: int,
) -> FlightPrice:
    """In to one airport and home from another: two one-way fares, added up."""
    key = cache_key(
        "trip-flight-oj", mine.origin_code, dest, leave, str(start), str(end), party, mine.kids
    )
    cached = await cache_get(key)
    if cached:
        return FlightPrice(**cached)
    try:
        out = await _one_way(mine.origin_code, dest, start, party, mine.kids)
        back = await _one_way(leave, mine.origin_code, end, party, mine.kids)
    except (TripJackError, TripJackNotConfigured):
        log.warning("open-jaw flight price failed", exc_info=True)
        return base.model_copy(update={"status": "error"})
    if not out or not back:
        return base.model_copy(update={"status": "unavailable"})
    result = base.model_copy(update={
        "status": "priced", "legs": [out, back],
        "total": round((out.price or 0) + (back.price or 0), 2),
        "checked_at": datetime.now(IST).isoformat(),
    })
    await cache_set(key, result.model_dump(mode="json"), FRESH_SECONDS)
    return result


async def flight_price(mine: TravellerTrip) -> FlightPrice:
    base = FlightPrice(status="no_dates")
    party = mine.adults + mine.seniors
    start, end = mine.start_date, mine.start_date + dt.timedelta(days=max(0, mine.days - 1)) \
        if mine.start_date else None
    if start is None or end is None or start < dt.date.today() or party < 1:
        return base
    if not mine.origin_code:
        return base.model_copy(update={"status": "no_origin"})
    # The trip may arrive at one airport and leave from another (Bagdogra in, Paro out): the airport
    # the video names, then the destination's own; and the last town's airport on the way out.
    route = builder.route_from(mine.source_items or [])
    named = next(
        (airport_for(r["name"]) for r in route if r["airport"] and airport_for(r["name"])), None
    )
    dest = named or airport_for(mine.destination_name)
    # (an area the video names with no day is not where the trip ends)
    towns = [r for r in route if not r["airport"] and r["day"]]
    leave = (airport_for(towns[-1]["name"]) if towns else None) or dest
    if dest is None:
        return base.model_copy(update={"status": "no_airport"})
    base = base.model_copy(update={"origin": mine.origin_code, "destination": dest,
                                   "adults": party, "children": mine.kids})
    if dest == mine.origin_code or end <= start:
        return base.model_copy(update={"status": "same_city"})
    if not tripjack_flights.configured:
        return base.model_copy(update={"status": "error"})
    if leave != dest:
        return await _open_jaw(base, mine, dest, leave, start, end, party)

    query = FlightSearch(
        legs=[Leg(origin=mine.origin_code, destination=dest, date=start),
              Leg(origin=dest, destination=mine.origin_code, date=end)],
        adults=party, children=mine.kids,
    )
    key = cache_key("trip-flight", query.to_tripjack(), settings.tripjack_flight_markup_percent)
    cached = await cache_get(key)
    if cached:
        return FlightPrice(**cached)
    try:
        found = (await service.search(query))["flights"]
    except (TripJackError, TripJackNotConfigured):
        log.warning("trip flight price failed", exc_info=True)
        return base.model_copy(update={"status": "error"})
    out, back = _cheapest(found, "ONWARD"), _cheapest(found, "RETURN")
    legs: list[FlightLeg] = []
    if out and back:
        legs = [_leg(out, mine.origin_code, dest, start), _leg(back, dest, mine.origin_code, end)]
    combos = [f for f in found if f["journey"] not in ("ONWARD", "RETURN")]
    if combos:
        # A return fare priced as one: it covers both ways.
        c = min(combos, key=lambda f: f["cheapest"]["price"]["total"])
        total_c = c["cheapest"]["price"]["total"]
        if not legs or total_c < sum(leg.price or 0 for leg in legs):
            legs = [
                FlightLeg(from_code=mine.origin_code, to_code=dest, date=start,
                          airline=(c["airlines"][0]["name"] if c.get("airlines") else ""),
                          departs=c.get("departs"), stops=c.get("stops", 0), price=total_c)
            ]
    if not legs:
        return base.model_copy(update={"status": "unavailable"})
    result = base.model_copy(update={
        "status": "priced", "legs": legs, "total": round(sum(leg.price or 0 for leg in legs), 2),
        "checked_at": datetime.now(IST).isoformat(),
    })
    await cache_set(key, result.model_dump(mode="json"), FRESH_SECONDS)
    return result
