"""Where did this data come from?

Every real call to TripJack made while serving one request is recorded: which host and path, the
HTTP status, how long it took, and a compact copy of the values TripJack returned (hotel ids,
names, prices, fare ids...). The response says which calls it was built from, and staff can read
the recorded values back to check that what we show is what TripJack sent.

The API key is never recorded. Evidence lives in Redis for an hour; a response served from our
own short cache points at the trace of the TripJack call that first produced it."""

import contextlib
import json
import logging
import time
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.core.config import settings
from app.modules.tripjack.cache import _client

log = logging.getLogger(__name__)

EVIDENCE_SECONDS = 3600


@dataclass
class Call:
    product: str  # hotels | flights | insurance
    method: str
    host: str
    path: str
    status: int | None
    ms: int
    bytes: int
    ok: bool
    attempts: int = 1
    error: str = ""
    # The values TripJack returned, in compact form (see each client's `excerpt`).
    excerpt: dict[str, Any] | None = None

    def summary(self) -> dict:
        return {
            "product": self.product,
            "endpoint": f"{self.method} {self.host}{self.path}",
            "status": self.status,
            "ok": self.ok,
            "ms": self.ms,
            "bytes": self.bytes,
            "attempts": self.attempts,
            "error": self.error,
        }


@dataclass
class Trace:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    started: float = field(default_factory=time.monotonic)
    calls: list[Call] = field(default_factory=list)
    # Set when the answer came from our own cache: the trace of the call that first produced it.
    cache: dict | None = None

    def environment(self) -> str:
        host = settings.tripjack_api_url
        return "UAT (TripJack test environment)" if "apitest" in host else "PRODUCTION"

    def public(self) -> dict:
        """What goes in a response: the calls (no values) and where the answer came from."""
        out: dict[str, Any] = {
            "name": "tripjack",
            "environment": self.environment(),
            "trace_id": self.id,
            "served_from": "tripjack" if self.calls else "cache",
            "upstream_ms": sum(c.ms for c in self.calls),
            "server_ms": int((time.monotonic() - self.started) * 1000),
            "calls": [c.summary() for c in self.calls],
        }
        if self.cache:
            age = None
            with contextlib.suppress(KeyError, TypeError, ValueError):
                then = datetime.fromisoformat(self.cache["at"])
                age = int((datetime.now(UTC) - then).total_seconds())
            out["cache"] = {"original_trace_id": self.cache.get("id"), "age_seconds": age}
        return out

    def evidence(self) -> dict:
        return {
            "trace_id": self.id,
            "environment": self.environment(),
            "recorded_at": datetime.now(UTC).isoformat(),
            "markup_percent": {
                "hotels": settings.tripjack_markup_percent,
                "flights": settings.tripjack_flight_markup_percent,
                "insurance": settings.tripjack_insurance_markup_percent,
            },
            "calls": [{**c.summary(), "excerpt": c.excerpt} for c in self.calls],
        }


_current: ContextVar[Trace | None] = ContextVar("tripjack_trace", default=None)


def start() -> Trace:
    trace = Trace()
    _current.set(trace)
    return trace


def current() -> Trace | None:
    return _current.get()


def record(call: Call) -> None:
    trace = _current.get()
    if trace is not None:
        trace.calls.append(call)


def stamp() -> dict | None:
    """Goes into a cached payload so a later hit can say where it first came from."""
    trace = _current.get()
    return {"id": trace.id, "at": datetime.now(UTC).isoformat()} if trace else None


def note_cache(stamped: dict | None) -> None:
    trace = _current.get()
    if trace is not None and stamped:
        trace.cache = stamped


async def finish(trace: Trace) -> dict:
    """Keep the evidence (when TripJack was really called) and return the public block."""
    if trace.calls:
        try:
            await _client().set(
                f"tj:trace:{trace.id}", json.dumps(trace.evidence()), ex=EVIDENCE_SECONDS
            )
        except Exception:  # noqa: BLE001 - losing evidence must never break a search
            log.warning("could not store TripJack evidence", exc_info=True)
    return trace.public()


async def load(trace_id: str) -> dict | None:
    try:
        raw = await _client().get(f"tj:trace:{trace_id}")
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        log.warning("could not read TripJack evidence", exc_info=True)
        return None


async def explain(trace: Trace, exc: Exception) -> dict[str, str]:
    """For a failed request: keep the evidence (the calls, with why they failed) and return the
    header that points at it, so a failure is never a mystery."""
    await finish(trace)
    return {"X-TripJack-Trace": trace.id}
