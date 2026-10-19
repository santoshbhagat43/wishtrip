"""Read a TripJack flight search into what we show. Fares are priced for the whole party, our
markup goes on the base fare only (taxes pass through), and our own commission (NCM) is never
exposed. Every price comes from the live search; nothing is estimated."""

from datetime import datetime

from app.core.config import settings

REFUNDABLE = {0: "non_refundable", 1: "refundable", 2: "partially_refundable"}


def _money(value) -> float:
    return round(float(value or 0), 2)


def apply_markup(base: float, percent: float | None = None) -> float:
    pct = settings.tripjack_flight_markup_percent if percent is None else percent
    return _money(float(base or 0) * (1 + pct / 100))


def _airport(a: dict | None) -> dict:
    a = a or {}
    return {
        "code": a.get("code") or "",
        "name": a.get("name") or "",
        "city": a.get("city") or "",
        "country": a.get("country") or "",
        "terminal": a.get("terminal") or "",
    }


def _minutes(a: str | None, b: str | None) -> int:
    try:
        return int((datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() // 60)
    except (TypeError, ValueError):
        return 0


def segment(raw: dict) -> dict:
    info = raw.get("fD") or {}
    airline = info.get("aI") or {}
    duration = raw.get("duration")
    if duration is None:
        duration = _minutes(raw.get("dt"), raw.get("at"))
    return {
        "airline": {
            "code": airline.get("code") or "",
            "name": airline.get("name") or "",
            "low_cost": bool(airline.get("isLcc")),
        },
        "flight_number": f"{airline.get('code') or ''}{info.get('fN') or ''}",
        "from": _airport(raw.get("da")),
        "to": _airport(raw.get("aa")),
        "departs": raw.get("dt"),
        "arrives": raw.get("at"),
        "duration_minutes": int(duration or 0),
        # Time spent waiting at the arrival airport for the next segment, when there is one.
        "layover_minutes": int(raw.get("cT") or 0),
        "technical_stops": int(raw.get("stops") or 0),
    }


def split_legs(segments: list[dict], routes: list[tuple[str, str]]) -> list[list[dict]]:
    """A combined trip (international return, multi-city) is one flat list of segments; cut it
    where a segment leaves from the next requested leg's origin."""
    if len(routes) < 2:
        return [segments]
    legs: list[list[dict]] = [[]]
    for seg in segments:
        i = len(legs) - 1
        prev = legs[i][-1] if legs[i] else None
        if (
            prev
            and i + 1 < len(routes)
            and prev["to"]["code"] == routes[i][1]
            and seg["from"]["code"] == routes[i + 1][0]
        ):
            legs.append([])
        legs[-1].append(seg)
    return legs


def fare(raw: dict, party: dict[str, int]) -> dict | None:
    per_pax = raw.get("fd") or raw.get("fD") or {}
    base = taxes = 0.0
    adult = per_pax.get("ADULT") or {}
    for pax, count in party.items():
        if not count:
            continue
        fc = (per_pax.get(pax) or {}).get("fC") or {}
        base += float(fc.get("BF") or 0) * count
        taxes += float(fc.get("TAF") or 0) * count
    if not raw.get("id") or base + taxes <= 0:
        return None
    baggage = adult.get("bI") or {}
    marked_up = apply_markup(base)
    return {
        "price_id": raw["id"],
        "fare_type": raw.get("fareIdentifier") or "PUBLISHED",
        "cabin": adult.get("cc") or "",
        "fare_name": adult.get("fB") or "",
        "refundable": REFUNDABLE.get(adult.get("rT"), "unknown"),
        "baggage": {"check_in": baggage.get("iB") or "", "cabin": baggage.get("cB") or ""},
        "seats_left": adult.get("sR"),
        "price": {
            "base": marked_up,
            "taxes": _money(taxes),
            "total": _money(marked_up + taxes),
            "currency": "INR",
        },
        # Special-return fares only work when both legs are picked from the same family.
        "special_return": {"sri": raw.get("sri"), "msri": raw.get("msri")}
        if raw.get("fareIdentifier") == "SPECIAL_RETURN"
        else None,
    }


def trip(
    journey: str, raw: dict, party: dict[str, int], routes: list[tuple[str, str]]
) -> dict | None:
    segments = [segment(s) for s in raw.get("sI") or []]
    fares = sorted(
        (f for r in raw.get("totalPriceList") or [] if (f := fare(r, party))),
        key=lambda f: f["price"]["total"],
    )
    if not segments or not fares:
        return None
    duration = sum(s["duration_minutes"] + s["layover_minutes"] for s in segments)
    duration -= segments[-1]["layover_minutes"]
    airlines = list({s["airline"]["code"]: s["airline"] for s in segments}.values())
    return {
        "journey": journey,
        "legs": split_legs(segments, routes),
        "departs": segments[0]["departs"],
        "arrives": segments[-1]["arrives"],
        "duration_minutes": duration,
        "stops": max(len(segments) - 1, 0),
        "airlines": airlines,
        "cheapest": fares[0],
        "fares": fares,
    }


def normalise(body: dict, party: dict[str, int], routes: list[tuple[str, str]]) -> list[dict]:
    """Every trip across the response's journey keys (ONWARD, RETURN, COMBO, indexed keys)."""
    out: list[dict] = []
    trips = (body.get("searchResult") or {}).get("tripInfos") or {}
    for journey, items in trips.items():
        for raw in items or []:
            if t := trip(journey, raw, party, routes):
                out.append(t)
    return out


SORTS = {
    "price": lambda t: t["cheapest"]["price"]["total"],
    "duration": lambda t: t["duration_minutes"],
    "departure": lambda t: t["departs"] or "",
}


def _hours(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fare_rules(body: dict) -> dict:
    """Rules by sector (e.g. "DEL-GOI"), each as CANCELLATION / DATECHANGE / NO_SHOW /
    SEAT_CHARGEABLE bands in hours before departure (TripJack sends the hours as strings)."""
    sectors: dict[str, dict[str, list[dict]]] = {}
    for sector, entry in (body.get("fareRule") or {}).items():
        if not isinstance(entry, dict):
            continue
        rules: dict[str, list[dict]] = {}
        for kind, bands in (entry.get("tfr") or {}).items():
            rules[kind] = [
                {
                    "from_hours": _hours(r.get("st")),
                    "to_hours": _hours(r.get("et")),
                    "period": r.get("pp"),
                    "airline_fee": _money(r.get("amount")),
                    "service_fee": _money(r.get("additionalFee")),
                    "note": r.get("policyInfo") or "",
                }
                for r in bands or []
            ]
        sectors[sector] = rules
    return {"sectors": sectors}
