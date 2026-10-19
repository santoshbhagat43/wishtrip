"""Turn a TripJack option into what we show: our markup applied, fees kept separate,
cancellation read into a plain "free until" line. Prices come only from live calls."""

from datetime import datetime, timedelta, timezone

from app.core.config import settings

# TripJack's cancellation times are naive and in IST (GMT+5:30).
IST = timezone(timedelta(hours=5, minutes=30))


def _money(value: float) -> float:
    return round(float(value or 0), 2)


def apply_markup(base: float, percent: float | None = None) -> float:
    pct = settings.tripjack_markup_percent if percent is None else percent
    return _money(float(base or 0) * (1 + pct / 100))


def _ist(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value).replace(tzinfo=IST)
    except (TypeError, ValueError):
        return None


def cancellation_summary(cancellation: dict, now: datetime | None = None) -> dict:
    """`free_until` is set when today falls in a zero-penalty slab; the first charge after it
    is `first_penalty`. Slabs are passed through unchanged for the detail view."""
    now = now or datetime.now(IST)
    penalties = cancellation.get("penalties") or []
    free_until: datetime | None = None
    for slab in penalties:
        start, end = _ist(slab.get("from")), _ist(slab.get("to"))
        if start and end and float(slab.get("amount") or 0) == 0 and start <= now <= end:
            free_until = end
            break
    return {
        "refundable": bool(cancellation.get("isRefundable")),
        "free_until": free_until.isoformat() if free_until else None,
        "slabs": [
            {"from": s.get("from"), "to": s.get("to"), "amount": _money(s.get("amount"))}
            for s in penalties
        ],
    }


def normalise_option(option: dict) -> dict | None:
    """None when the option is not bookable (inventory says unavailable)."""
    inventory = option.get("inventory")
    if isinstance(inventory, dict) and inventory.get("available") is False:
        return None
    p = option.get("pricing") or {}
    base = apply_markup(p.get("basePrice"))
    taxes, mf, mft = _money(p.get("taxes")), _money(p.get("mf")), _money(p.get("mft"))
    discount = _money(p.get("discount"))
    compliance = option.get("compliance") or {}
    return {
        "option_id": option.get("optionId"),
        "option_type": option.get("optionType"),
        "rooms": [
            {"name": r.get("name") or "", "adults": r.get("adults"), "children": r.get("children")}
            for r in option.get("roomInfo") or []
        ],
        "meal_basis": option.get("mealBasis") or "",
        "inclusions": option.get("inclusions") or [],
        "booking_notes": option.get("bookingNotes") or "",
        # total = base + taxes + management fee + its tax; the fee is shown as its own line.
        "price": {
            "base": base,
            "taxes": taxes,
            "management_fee": mf,
            "management_fee_tax": mft,
            "discount": discount,
            "total": _money(base + taxes + mf + mft),
            "currency": p.get("currency") or settings.tripjack_currency,
        },
        "needs_pan": bool(compliance.get("panRequired")),
        "needs_passport": bool(compliance.get("passportRequired")),
        "gst_type": compliance.get("gstType") or "NA",
        "cancellation": cancellation_summary(option.get("cancellation") or {}),
    }


def normalise_options(options: list[dict]) -> list[dict]:
    out = [o for raw in options if (o := normalise_option(raw))]
    return sorted(out, key=lambda o: o["price"]["total"])
