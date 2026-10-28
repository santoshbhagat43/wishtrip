"""Booking a TripJack flight from the dashboard, to test the API: review a fare, hold it (or book it
outright), read the booking, ticket a hold or release it.

Only ever against TripJack's test environment (UAT): a booking there costs nothing and holds no
real seat. Against production every call here is refused, since a hold makes a real PNR and a
booking spends real money. Amounts sent to TripJack are TripJack's own total from the review
(`TF`), never our marked-up price: TripJack refuses any other amount."""

import datetime as dt
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.config import settings
from app.modules.flights.client import tripjack_flights

# Keys in a booking's answer that can carry when a hold runs out. TripJack's documentation names
# none, so every key that looks like a deadline is shown as it came.
DEADLINE = re.compile(r"time.?limit|hold|ttl|tktl|expir|last.?ticket|valid.?till|release", re.I)


def is_test_environment() -> bool:
    return "apitest" in settings.tripjack_api_url


class ReviewQuery(BaseModel):
    # One fare id for one-way, international return and multi-city; two for a domestic return.
    price_ids: list[str] = Field(min_length=1, max_length=6)


class Traveller(BaseModel):
    type: Literal["ADULT", "CHILD", "INFANT"] = "ADULT"
    title: Literal["Mr", "Mrs", "Ms", "Master"] = "Mr"
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    dob: dt.date | None = None
    pan: str = Field("", max_length=10)
    passport_number: str = Field("", max_length=20)
    passport_expiry: dt.date | None = None
    passport_nationality: str = Field("", max_length=2)

    def to_tripjack(self) -> dict:
        out: dict[str, Any] = {
            "ti": self.title, "pt": self.type, "fN": self.first_name.strip(),
            "lN": self.last_name.strip(),
        }  # fmt: skip
        if self.dob:
            out["dob"] = self.dob.isoformat()
        if self.pan:
            out["pan"] = self.pan.upper()
        if self.passport_number:
            out["pNum"] = self.passport_number.upper()
        if self.passport_expiry:
            out["eD"] = self.passport_expiry.isoformat()
        if self.passport_nationality:
            out["pNat"] = self.passport_nationality.upper()
        return out


class BookQuery(BaseModel):
    booking_id: str = Field(min_length=3)
    # hold: blocks the seats, no payment (only when the review says hold is allowed).
    # book: tickets at once, paid from our TripJack wallet.
    mode: Literal["hold", "book"] = "hold"
    # For "book": TripJack's total from the review (TF).
    amount: float | None = Field(None, gt=0)
    travellers: list[Traveller] = Field(min_length=1, max_length=9)
    email: str = Field(min_length=3, max_length=120)
    # With the country code, e.g. +919500112233.
    phone: str = Field(min_length=8, max_length=16, pattern=r"^\+\d{7,15}$")


class ConfirmQuery(BaseModel):
    amount: float = Field(gt=0)


class ReleaseQuery(BaseModel):
    pnrs: list[str] = Field(default_factory=list, max_length=6)


def _money(value: Any) -> float | None:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _total(body: dict) -> float | None:
    """TripJack's total fare (TF) in a review or a booking."""
    info = body.get("totalPriceInfo") or {}
    return _money(((info.get("totalFareDetail") or {}).get("fC") or {}).get("TF"))


def deadlines(value: Any, path: str = "") -> dict[str, Any]:
    """Every value in the answer under a key that looks like a hold deadline, by where it sits."""
    found: dict[str, Any] = {}
    if isinstance(value, dict):
        for k, v in value.items():
            here = f"{path}.{k}" if path else str(k)
            if DEADLINE.search(str(k)) and not isinstance(v, dict | list):
                found[here] = v
            found.update(deadlines(v, here))
    elif isinstance(value, list):
        for n, v in enumerate(value):
            found.update(deadlines(v, f"{path}[{n}]"))
    return found


def review_summary(body: dict) -> dict:
    c = body.get("conditions") or {}
    dob = c.get("dob") or {}
    pcs = c.get("pcs") or {}
    gst = c.get("gst") or {}
    return {
        "booking_id": body.get("bookingId"),
        "total": _total(body),
        "currency": "INR",
        "hold_allowed": bool(c.get("isBA")),
        "session_seconds": c.get("st"),
        "session_started": c.get("sct"),
        "needs": {
            "pan": bool(c.get("ipa")),
            "passport": bool(pcs.get("pm") or c.get("pm")),
            "passport_expiry": bool(pcs.get("pped") or c.get("pped")),
            "dob_adult": bool(dob.get("adobr") or c.get("adobr")),
            "dob_child": bool(dob.get("cdobr") or c.get("cdobr")),
            "dob_infant": bool(dob.get("idobr") or c.get("idobr")),
            "gst": bool(gst.get("igm") or c.get("igm")),
            "emergency_contact": bool(c.get("iecr")),
        },
        "alerts": body.get("alerts") or [],
        "raw": body,
    }


def booking_summary(body: dict) -> dict:
    order = body.get("order") or {}
    air = ((body.get("itemInfos") or {}).get("AIR")) or {}
    travellers = air.get("travellerInfos") or []
    pnrs = sorted({p for t in travellers for p in (t.get("pnrDetails") or {}).values() if p})
    tickets = sorted(
        {n for t in travellers for n in (t.get("ticketNumberDetails") or {}).values() if n}
    )
    return {
        "booking_id": order.get("bookingId"),
        "status": order.get("status"),
        "amount": _money(order.get("amount")),
        "total": _total(air),
        "pnrs": pnrs,
        "tickets": tickets,
        "travellers": [
            {"name": f"{t.get('fN', '')} {t.get('lN', '')}".strip(), "type": t.get("pt")}
            for t in travellers
        ],
        "created_on": order.get("createdOn"),
        # When the hold runs out, as TripJack put it (see DEADLINE).
        "hold_deadlines": deadlines(body),
        "raw": body,
    }


async def review(q: ReviewQuery) -> dict:
    return review_summary(await tripjack_flights.review(q.price_ids))


async def book(q: BookQuery) -> dict:
    body: dict[str, Any] = {
        "bookingId": q.booking_id,
        "travellerInfo": [t.to_tripjack() for t in q.travellers],
        "deliveryInfo": {"emails": [q.email], "contacts": [q.phone]},
    }
    if q.mode == "book":
        if q.amount is None:
            raise ValueError("amount (TripJack's total from the review) is needed to book")
        body["paymentInfos"] = [{"amount": q.amount}]
    answer = await tripjack_flights.book(body)
    return {"booking_id": answer.get("bookingId") or q.booking_id, "mode": q.mode, "raw": answer}


async def details(booking_id: str) -> dict:
    return booking_summary(await tripjack_flights.booking_details(booking_id))


async def confirm(booking_id: str, q: ConfirmQuery) -> dict:
    """Ticket a hold: TripJack checks the held fare first, then tickets it for `amount`."""
    checked = await tripjack_flights.validate_hold(booking_id)
    answer = await tripjack_flights.confirm_hold(booking_id, q.amount)
    return {"booking_id": booking_id, "validated": checked, "raw": answer}


async def release(booking_id: str, q: ReleaseQuery) -> dict:
    pnrs = q.pnrs or (await details(booking_id))["pnrs"]
    answer = await tripjack_flights.release_hold(booking_id, pnrs)
    return {"booking_id": booking_id, "pnrs": pnrs, "raw": answer}
