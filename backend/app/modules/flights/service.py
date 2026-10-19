import logging

from app.core.config import settings
from app.modules.flights import pricing
from app.modules.flights.client import tripjack_flights
from app.modules.flights.schemas import FareRuleQuery, FlightSearch
from app.modules.tripjack.cache import cache_get, cache_key, cache_set

log = logging.getLogger(__name__)


async def search(q: FlightSearch) -> dict:
    """One call to TripJack covers one-way, return and multi-city. Results are cached for a few
    minutes (a priceId is good for 15), so repeat searches never reach TripJack."""
    query = q.to_tripjack()
    key = cache_key("flights", query, settings.tripjack_flight_markup_percent)
    cached = await cache_get(key)
    if cached is None:
        party = {"ADULT": q.adults, "CHILD": q.children, "INFANT": q.infants}
        routes = [(leg.origin, leg.destination) for leg in q.legs]
        body = await tripjack_flights.search(query)
        cached = {"flights": pricing.normalise(body, party, routes)}
        if cached["flights"]:
            await cache_set(key, cached, settings.tripjack_flight_cache_seconds)
    flights = sorted(cached["flights"], key=pricing.SORTS[q.sort])
    return {"total": len(flights), "flights": flights}


async def fare_rules(q: FareRuleQuery) -> dict:
    key = cache_key("farerule", q.price_id)
    cached = await cache_get(key)
    if cached is None:
        cached = pricing.fare_rules(await tripjack_flights.fare_rule(q.price_id))
        await cache_set(key, cached, settings.tripjack_flight_cache_seconds)
    return cached
