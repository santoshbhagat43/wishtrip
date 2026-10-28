import json
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_staff
from app.core.pagination import Page
from app.db.session import get_session
from app.modules.tripjack import logs, trace
from app.modules.tripjack.models import TripJackLog
from app.modules.users.models import User

router = APIRouter(prefix="/tripjack", tags=["tripjack"])


@router.get("/evidence/{trace_id}")
async def evidence(trace_id: str, _: User = Depends(require_staff)):
    """What TripJack really returned for the request that carried this `supplier.trace_id`:
    each call (host, status, timing) and a compact copy of the values it sent (hotel ids, names,
    prices, fare ids). For checking that what we show is what TripJack said. Kept for an hour;
    the API key is never recorded."""
    found = await trace.load(trace_id)
    if found is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No record of that request (kept for an hour)"
        )
    return found


# --- The log of calls: what we send TripJack and what it answers ------------------------------


class LogRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    product: str
    method: str
    path: str
    status: int | None = None
    ok: bool
    ms: int
    attempts: int
    response_bytes: int
    error: str = ""
    trace_id: str = ""
    environment: str = ""


class LogDetail(LogRow):
    url: str
    request_headers: dict
    request_body: dict | list | None = None
    request_params: dict | None = None
    response_headers: dict
    response_body: str
    response_truncated: bool
    # The whole answer can be read at /tripjack/logs/{id}/response (it was cut here).
    response_full: bool = False


Outcome = Literal["all", "ok", "failed"]


def _filtered(
    query: Select, product: str | None, outcome: Outcome, q: str | None, days: int | None
) -> Select:
    if product:
        query = query.where(TripJackLog.product == product)
    if outcome != "all":
        query = query.where(TripJackLog.ok.is_(outcome == "ok"))
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.where(
            TripJackLog.path.ilike(like)
            | TripJackLog.trace_id.ilike(like)
            | TripJackLog.error.ilike(like)
            | TripJackLog.response_body.ilike(like)
        )
    if days:
        query = query.where(TripJackLog.created_at >= datetime.now(UTC) - timedelta(days=days))
    return query


@router.get("/logs", response_model=Page[LogRow])
async def list_logs(
    product: Literal["hotels", "flights", "insurance"] | None = None,
    outcome: Outcome = "all",
    q: str | None = Query(None, description="Matches the path, trace id, error or the answer"),
    days: int | None = Query(None, ge=1, le=90),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """Every call to TripJack, newest first (without the bodies: open one for those)."""
    base = _filtered(select(TripJackLog), product, outcome, q, days)
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    rows = (
        await session.scalars(
            base.order_by(TripJackLog.created_at.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    ).all()
    return Page(
        items=[LogRow(**{**r.__dict__, "id": str(r.id)}) for r in rows],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def _get(session: AsyncSession, log_id: str) -> TripJackLog:
    try:
        row = await session.get(TripJackLog, log_id)
    except Exception:  # noqa: BLE001 - not a valid id
        row = None
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such call in the log")
    return row


@router.get("/logs/export", response_class=PlainTextResponse)
async def export_logs(
    product: Literal["hotels", "flights", "insurance"] | None = None,
    outcome: Outcome = "all",
    q: str | None = None,
    days: int | None = Query(None, ge=1, le=90),
    limit: int = Query(200, ge=1, le=1000),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """The log as a plain-text file, oldest first, in the form TripJack asks for: each call with
    its request and its response (for certification and support)."""
    base = _filtered(select(TripJackLog), product, outcome, q, days)
    rows = (await session.scalars(base.order_by(TripJackLog.created_at.desc()).limit(limit))).all()
    body = "\n".join(format_entry(r) for r in reversed(rows)) or "No calls recorded.\n"
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return PlainTextResponse(
        body, headers={"Content-Disposition": f'attachment; filename="tripjack-log-{stamp}.txt"'}
    )


@router.get("/logs/{log_id}", response_model=LogDetail)
async def read_log(
    log_id: str, session: AsyncSession = Depends(get_session), _: User = Depends(require_staff)
):
    row = await _get(session, log_id)
    kept = await session.scalar(
        select(TripJackLog.response_full.is_not(None)).where(TripJackLog.id == row.id)
    )
    return LogDetail(**{**row.__dict__, "id": str(row.id), "response_full": bool(kept)})


@router.get("/logs/{log_id}/response", response_class=PlainTextResponse)
async def read_full_response(
    log_id: str,
    download: bool = False,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """The whole answer TripJack sent for this call, as it sent it (what the log shows is cut
    when it is long). With `download`, as a file."""
    row = await _get(session, log_id)
    whole = await session.scalar(select(TripJackLog.response_full).where(TripJackLog.id == row.id))
    headers = {}
    if download:
        when = row.created_at.strftime("%Y%m%d-%H%M%S")
        name = f"tripjack-{row.product}-{when}-{str(row.id)[:8]}"
        headers["Content-Disposition"] = f'attachment; filename="{name}.json"'
    return PlainTextResponse(logs.full_text(row, whole), headers=headers)


def format_entry(r: TripJackLog) -> str:
    """One call, as a log entry: when, what we called, what we sent, what came back."""
    stamp = r.created_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    rule = "=" * 100
    out = [
        rule,
        f"{stamp} | {r.product.upper()} | {r.environment}",
        f"{r.method} {r.url}",
        f"trace {r.trace_id or '-'} | status {r.status if r.status is not None else 'no answer'}"
        f" | {r.ms} ms | {r.response_bytes} bytes | attempts {r.attempts}"
        f" | {'OK' if r.ok else 'FAILED'}",
    ]
    if r.error:
        out.append(f"error: {r.error}")
    out += ["", "--- REQUEST", *(f"{k}: {v}" for k, v in (r.request_headers or {}).items())]
    if r.request_params:
        out.append(f"query: {json.dumps(r.request_params, ensure_ascii=False)}")
    out += [
        "",
        json.dumps(r.request_body, indent=2, ensure_ascii=False)
        if r.request_body is not None
        else "(no body)",
        "",
        f"--- RESPONSE ({r.status if r.status is not None else 'none'})",
        *(f"{k}: {v}" for k, v in (r.response_headers or {}).items()),
        "",
        logs.pretty(r.response_body) if r.response_body else "(empty)",
    ]
    if r.response_truncated:
        out.append(f"... [cut: showing the first part of {r.response_bytes} bytes]")
    return "\n".join(out) + "\n"
