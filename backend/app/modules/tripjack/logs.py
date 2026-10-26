"""The record of every call to TripJack, kept in the database so staff can read what we sent and
what TripJack answered (dashboard → TripJack log). Never breaks a call: a failure to record is only
logged."""

import json
import logging
import random
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.tripjack import trace
from app.modules.tripjack.models import TripJackLog

log = logging.getLogger(__name__)

# Personal details in a request (travellers, contacts, documents) are never recorded.
SENSITIVE = re.compile(r"passport|pan|e-?mail|mobile|phone|dob|birth|gst|address|visa", re.I)
REDACTED = "[redacted]"


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: (REDACTED if SENSITIVE.search(str(k)) else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def mask_key(key: str | None) -> str:
    return f"…{key[-4:]}" if key and len(key) > 8 else "(hidden)"


def _limit(path: str) -> int:
    sync = "/content/" in path
    return settings.tripjack_log_sync_bytes if sync else settings.tripjack_log_body_bytes


def _row(call: "trace.Call", key: str | None) -> TripJackLog:
    text = call.response_text or ""
    limit = _limit(call.path)
    request = call.request or {}
    return TripJackLog(
        product=call.product,
        method=call.method,
        url=f"https://{call.host}{call.path}",
        path=call.path,
        request_headers={"apikey": mask_key(key), "Content-Type": "application/json"},
        request_body=redact(request.get("json")),
        request_params=redact(request.get("params")),
        status=call.status,
        response_headers=call.response_headers or {},
        response_body=text[:limit],
        response_bytes=call.bytes or len(text.encode()),
        response_truncated=len(text) > limit,
        ms=call.ms,
        attempts=call.attempts,
        ok=call.ok,
        error=call.error,
        trace_id=(trace.current().id if trace.current() else ""),
        environment=trace.Trace().environment(),
    )


async def save(call: "trace.Call", key: str | None) -> None:
    try:
        async with SessionLocal() as session:
            session.add(_row(call, key))
            if random.random() < 0.02:  # now and then, forget what is past the retention
                cutoff = datetime.now(UTC) - timedelta(days=settings.tripjack_log_days)
                await session.execute(delete(TripJackLog).where(TripJackLog.created_at < cutoff))
            await session.commit()
    except Exception:  # noqa: BLE001 - the record is a nicety, the call already happened
        log.warning("could not record the TripJack call %s", call.path, exc_info=True)


def pretty(text: str) -> str:
    """The answer, indented when it is JSON (and still whole when it was cut short)."""
    try:
        return json.dumps(json.loads(text), indent=2, ensure_ascii=False)
    except ValueError:
        return text
