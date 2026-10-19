"""Insurance plan search. The API is rate-limited (40 a minute), so results are cached."""

from app.core.config import settings
from app.modules.insurance.client import tripjack_insurance
from app.modules.insurance.schemas import InsuranceSearch
from app.modules.tripjack.cache import cache_get, cache_key, cache_set


def _money(value) -> float:
    return round(float(value or 0), 2)


def _components(pax: dict) -> dict:
    return pax.get("insuranceFareComponents") or {}


def plan(raw: dict) -> dict:
    pct = settings.tripjack_insurance_markup_percent
    fare = raw.get("fareDetails") or {}
    benefits = raw.get("productBenefits") or []
    # Headline callouts first, then the full detail grouped by area (Medical, Baggage, ...).
    banner = [b["name"] for b in benefits if b.get("visibility") == "BANNER"]
    detail: dict[str, list[dict]] = {}
    for b in benefits:
        if b.get("visibility") == "POPUP" and b.get("type") == "INSURANCE_BENEFIT":
            detail.setdefault(b.get("iconCategory") or "Other", []).append(
                {"name": b.get("name") or "", "description": b.get("description") or ""}
            )
    return {
        "product_id": raw.get("productId"),
        "plan_type": raw.get("planType") or "REGULAR",
        "insurer": raw.get("insuranceProvider") or "",
        "assistance": raw.get("assistanceProviders") or [],
        "region": raw.get("regionName") or "",
        "coverage": raw.get("planCoverage") or "",
        "highlights": list(dict.fromkeys(banner)),
        "benefits": detail,
        # Whole-trip premium for every traveller. The API does not state a currency; ours
        # are INR accounts. Our commission (agentCommission) is never exposed.
        "price": {
            "total": _money(_money(fare.get("totalFare")) * (1 + pct / 100)),
            "currency": "INR",
        },
        "travellers": [
            {"age": p.get("age"), "total": _money(_components(p).get("TF"))}
            for p in raw.get("paxFareDetails") or []
        ],
    }


async def search(q: InsuranceSearch) -> dict:
    body = q.to_tripjack()
    key = cache_key("insurance", body, settings.tripjack_insurance_markup_percent)
    cached = await cache_get(key)
    if cached is None:
        data = await tripjack_insurance.search(body)
        plans = sorted(
            (plan(p) for p in data.get("productInfo") or []), key=lambda p: p["price"]["total"]
        )
        cached = {"search_id": data.get("searchId"), "plans": plans}
        if plans:
            await cache_set(key, cached, settings.tripjack_insurance_cache_seconds)
    return {**cached, "total": len(cached["plans"]), "journey": q.journey}
