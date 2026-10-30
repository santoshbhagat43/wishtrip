"""Make it mine: a traveller's trip, built for who is going. It starts from a creator's published
trip or from a reel the traveller pasted; the places in it are planned day by day for the party
(solo, couple, family, elderly or flexible: see builder.py), and kept under a short code to come
back to and change."""

import datetime as dt
import logging
import re
import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.config import settings
from app.core.deps import get_current_user, require_staff
from app.core.errors import bad_request, not_found
from app.core.ratelimit import allow
from app.db.session import get_session
from app.modules.chat.models import ChatSession
from app.modules.creators import builder, flight_prices, stay_prices, stays, trips
from app.modules.creators.models import Creator, CreatorTrip, TravellerTrip, TripStatus
from app.modules.creators.schemas import PublicCreator, TripItem
from app.modules.hotels import photos
from app.modules.media.storage import storage
from app.modules.reels.models import CreatorContent, ImportStatus, ReelImport
from app.modules.users.models import User

log = logging.getLogger(__name__)

router = APIRouter(tags=["trips"])

PACES = ("relaxed", "balanced", "packed")
# The budget choices on the Details screen, for the whole trip, as the planner is told them.
BUDGETS = {
    "under_40k": "under ₹40,000",
    "40k_60k": "₹40,000 to ₹60,000",
    "60k_80k": "₹60,000 to ₹80,000",
    "no_limit": "no fixed limit",
}
# No 0/O/1/I/L: a code read out or typed from a message stays unambiguous.
ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


class MineConfig(BaseModel):
    # Nobody is assumed: who is going comes from the traveller (or the staff check, which says so).
    adults: int = Field(default=0, ge=0, le=9)
    kids: int = Field(default=0, ge=0, le=9)
    seniors: int = Field(default=0, ge=0, le=9)
    days: int = Field(default=4, ge=1, le=builder.MAX_DAYS)
    pace: str = "relaxed"
    when: str = Field(default="", max_length=80)
    # Who is going, as the Details screen names it: couple, family, friends, seniors, …
    group: str = Field(default="", max_length=16)
    # When they leave and from where: required to make a trip board, so its prices are real.
    start_date: dt.date | None = None
    origin: str = Field(default="", max_length=3)
    origin_city: str = Field(default="", max_length=100)
    # The traveller chose to shape the trip in the Arya chat: arrange the stops by rule now and
    # let the chat do the planning, instead of building it with the AI in the background.
    arya: bool = False
    # Optional: the budget for the whole trip (an id from BUDGETS) and anything we should know.
    budget: str = Field(default="", max_length=16)
    notes: str = Field(default="", max_length=300)


class MineRead(BaseModel):
    code: str
    source_share_code: str
    title: str
    destination_name: str
    summary: str
    cover_image_url: str | None = None
    creator: PublicCreator
    items: list[TripItem]
    adults: int
    kids: int
    seniors: int
    days: int
    pace: str
    when: str
    group: str = ""
    budget: str = ""
    notes: str = ""
    # building: being planned now (poll again) · ready · failed (change the details to retry).
    build_status: str = "ready"
    build_error: str = ""
    # The rules the plan follows: solo, couple, family, elderly or flexible.
    persona: str = ""
    # False when the days were arranged from the known places without the AI.
    ai_built: bool = False
    plan_summary: str = ""
    tips: list[str] = []
    # When and from where, for real prices: the start date, the last day of the plan, and the
    # airport or city code and name they travel from.
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    origin: str = ""
    origin_city: str = ""
    # The reel it was built from, when it came from one (for going back to the Details screen).
    import_id: str | None = None


def trip_dates(mine: TravellerTrip) -> tuple[dt.date | None, dt.date | None]:
    """Leaving and coming back: the start date, and the last day of the plan."""
    if mine.start_date is None:
        return None, None
    return mine.start_date, mine.start_date + dt.timedelta(days=max(0, mine.days - 1))


def _when_text(start: dt.date | None, days: int, typed: str) -> str:
    """What the page says about the dates: the range they picked, else what they typed."""
    if start is None:
        return " ".join(typed.split())
    end = start + dt.timedelta(days=max(0, days - 1))
    if start == end:
        return f"{start.day} {start:%b %Y}"
    first = f"{start.day} {start:%b}" if start.year == end.year else f"{start.day} {start:%b %Y}"
    return f"{first} – {end.day} {end:%b %Y}"


def _check(config: MineConfig) -> None:
    """A trip board is only made for a whole set of details: when they leave, where from, and who
    is going (with a grown-up, as every room and booking needs one). With those, the flights and
    hotels on the board are priced for the real trip, not guessed."""
    if config.start_date is None:
        raise bad_request("Choose the date you leave.")
    if config.start_date < dt.date.today():
        raise bad_request("Choose a start date that is today or later.")
    if not (len(config.origin) == 3 and config.origin.isalpha()):
        raise bad_request("Pick the city you are flying from.")
    if config.adults + config.kids + config.seniors < 1:
        raise bad_request("Add at least one traveller.")
    if config.adults + config.seniors < 1:
        raise bad_request("Add at least one adult: every room and booking needs one.")
    if config.pace not in PACES:
        raise bad_request("Pace is relaxed, balanced or packed.")
    if config.budget and config.budget not in BUDGETS:
        raise bad_request("Choose a budget from the list.")


async def _unique_code(session: AsyncSession) -> str:
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(8))
        if not await session.scalar(select(exists().where(TravellerTrip.code == code))):
            return code


# What the chat once put on boards when Arya named a flight or a hotel we cannot book: not a stop.
PLACEHOLDER = re.compile(r"^sample \w+ option$", re.I)


def board_items(items: list[dict]) -> list[dict]:
    """The board as it is shown: chat placeholders left out, and a planned board (one with a time
    of day on its stops) in the order the day is lived. Shown this way, not saved: reading a
    trip never changes it."""
    shown = [i for i in items if not PLACEHOLDER.match(str(i.get("name") or "").strip())]
    if any(i.get("slot") for i in shown):
        shown = builder.in_day_order(shown)
    return shown


async def _read(session: AsyncSession, mine: TravellerTrip) -> MineRead:
    items, _ = await photos.attach(
        session, board_items(list(mine.items or [])), mine.source_trip_id, mine.destination_name,
        persist=False,
    )  # fmt: skip
    return MineRead(
        code=mine.code,
        source_share_code=mine.source_share_code,
        title=mine.title,
        destination_name=mine.destination_name,
        summary=mine.summary,
        cover_image_url=storage.url(mine.cover_image_key) if mine.cover_image_key else None,
        creator=PublicCreator(
            handle=mine.creator_handle,
            display_name=mine.creator_name or mine.creator_handle or "A wishtrip creator",
            referral_code=mine.creator_referral_code,
        ),
        items=[TripItem(**i) for i in items],
        adults=mine.adults,
        kids=mine.kids,
        seniors=mine.seniors,
        days=mine.days,
        pace=mine.pace,
        when=mine.when_text,
        group=mine.group,
        budget=mine.budget,
        notes=mine.notes,
        build_status=mine.build_status,
        build_error=mine.build_error,
        persona=mine.persona,
        ai_built=mine.ai_built,
        plan_summary=mine.plan_summary,
        start_date=trip_dates(mine)[0],
        end_date=trip_dates(mine)[1],
        origin=mine.origin_code,
        origin_city=mine.origin_city,
        tips=list(mine.tips or []),
        import_id=str(mine.source_import_id) if mine.source_import_id else None,
    )


def _apply(mine: TravellerTrip, config: MineConfig) -> bool:
    """Take the details. True when they change what the plan should be (so it is built again)."""
    def plan_inputs() -> tuple:
        return (mine.adults, mine.kids, mine.seniors, mine.days, mine.pace, mine.group,
                mine.budget, mine.notes)  # fmt: skip

    before = plan_inputs()
    mine.adults, mine.kids, mine.seniors = config.adults, config.kids, config.seniors
    mine.days, mine.pace, mine.group = config.days, config.pace, config.group
    mine.budget, mine.notes = config.budget, " ".join(config.notes.split())
    mine.start_date = config.start_date
    mine.origin_code = config.origin.upper()
    mine.origin_city = " ".join(config.origin_city.split())
    mine.when_text = _when_text(config.start_date, config.days, config.when)
    return before != plan_inputs()


# --- Building the plan -------------------------------------------------------------------------


async def _what_the_reel_said(
    session: AsyncSession, mine: TravellerTrip
) -> tuple[list[str], str, str]:
    """The tips the creator's reel gave, and its caption: how the trip should feel (a budget
    plan, a luxury one) and the practical points worth passing on."""
    job = await session.get(ReelImport, mine.source_import_id) if mine.source_import_id else None
    content = await session.get(CreatorContent, job.content_id) if job and job.content_id else None
    if content is None:
        return [], "", ""
    tips = [str(t) for t in (content.extracted or {}).get("tips") or [] if str(t).strip()]
    words = (content.transcript_en or content.transcript or "").strip()
    return tips, content.caption or "", words


async def run_build(session: AsyncSession, ai: AIOrchestrator | None, code: str) -> None:
    """Plan the trip for its party and save it. Never raises: a trip that could not be built says
    so (`build_status` "failed") and keeps the stops it had."""
    mine = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == code))
    if mine is None:
        return
    try:
        # Past the hourly cap the trip is arranged by rule, not refused.
        use_ai = ai if await allow("trip-builds", settings.trip_builds_per_hour) else None
        tips_from_reel, said, words = await _what_the_reel_said(session, mine)
        plan = await builder.build(
            use_ai,
            must=[i for i in mine.source_items or [] if i.get("kind") != "area"]
            + builder.town_days(mine.source_items or []),
            route=builder.route_from(mine.source_items or []),
            destination=mine.destination_name,
            days=mine.days,
            adults=mine.adults,
            kids=mine.kids,
            seniors=mine.seniors,
            pace=mine.pace,
            when=mine.when_text,
            group=mine.group,
            budget=BUDGETS.get(mine.budget, ""),
            notes=mine.notes,
            summary=mine.summary,
            origin_city=mine.origin_city,
            reel_tips=tips_from_reel,
            creator_words=words,
            domestic=await stays.same_country(session, mine.destination_name, mine.origin_city),
            # The creator's video is the trip: only its places, and the journey, are planned.
            reel_only=True,
        )
        plan["items"] = await stays.name_the_stay(
            session, plan["items"], mine.destination_name, mine.summary, said
        )
        mine.items = plan["items"]
        mine.tips = plan["tips"]
        mine.plan_summary = plan["summary"]
        mine.persona = plan["persona"]
        mine.ai_built = plan["ai_built"]
        mine.build_status, mine.build_error = "ready", ""
    except Exception as exc:  # noqa: BLE001 - recorded for the traveller, never a 500
        log.exception("building traveller trip %s failed", code)
        mine.build_status, mine.build_error = "failed", f"{type(exc).__name__}"[:300]
    await session.commit()


async def mark_failed(session: AsyncSession, code: str) -> None:
    mine = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == code))
    if mine is not None and mine.build_status == "building":
        mine.build_status, mine.build_error = "failed", "The trip could not be built. Try again."
        await session.commit()


async def _enqueue(session: AsyncSession, mine: TravellerTrip) -> None:
    """Start building (in a worker, or right here when there is none)."""
    if settings.reels_inline:
        await run_build(session, get_orchestrator(), mine.code)
        await session.refresh(mine)
        return
    try:
        from app.workers.tasks import build_traveller_trip_task

        build_traveller_trip_task.delay(mine.code)
    except Exception:  # noqa: BLE001 - the queue is down: say so instead of waiting forever
        log.exception("could not queue the build of %s", mine.code)
        mine.build_status, mine.build_error = "failed", "The trip could not be started. Try again."
        await session.commit()


# Swappable for tests, which build in place (or not at all).
enqueue = _enqueue


async def _start(session: AsyncSession, mine: TravellerTrip, *, quick: bool = False) -> None:
    mine.persona = builder.persona(mine.group, mine.adults, mine.kids, mine.seniors)
    if quick:
        must = [i for i in mine.source_items or [] if i.get("kind") != "area"]
        mine.items = builder.arrange(must, mine.days) if must else list(mine.items or [])
        mine.ai_built = False
        mine.build_status, mine.build_error = "ready", ""
        await session.commit()
        return
    mine.build_status, mine.build_error = "building", ""
    await session.commit()
    await enqueue(session, mine)


@router.post("/trips/{share_code}/make-mine", response_model=MineRead, status_code=201)
async def make_mine(
    share_code: str, config: MineConfig, session: AsyncSession = Depends(get_session)
):
    """Public: copy a published creator trip for this traveller, with their details. Returns the
    code to come back to."""
    _check(config)
    trip = await session.scalar(select(CreatorTrip).where(CreatorTrip.share_code == share_code))
    if not trip or trip.status != TripStatus.PUBLISHED:
        raise not_found("Trip")
    creator = await session.get(Creator, trip.creator_id)
    assert creator is not None
    mine = TravellerTrip(
        code=await _unique_code(session),
        source_trip_id=trip.id,
        source_share_code=share_code,
        title=trip.title,
        destination_name=trip.destination_name,
        summary=trip.summary,
        cover_image_key=trip.cover_image_key,
        creator_name=creator.display_name or (creator.handle or ""),
        creator_handle=creator.handle,
        creator_referral_code=creator.referral_code,
        items=trips.clean_items(trip.items or []),
    )
    # What it is built from: the creator's stops. Until the plan is ready, the trip shows them.
    mine.source_items = list(mine.items)
    _apply(mine, config)
    session.add(mine)
    await session.commit()
    await _start(session, mine, quick=config.arya)
    return await _read(session, mine)


def _place_item(place: dict) -> dict:
    """A place the reel named, as a stop to plan around."""
    kind = place.get("kind")
    return {
        "id": uuid.uuid4().hex,
        "kind": kind if kind in trips.ITEM_KINDS else "sight",
        "name": str(place.get("location_name") or place.get("name") or "")[:200],
        "note": str(place.get("evidence") or "")[:200],
        "day": None,
        "location_id": place.get("location_id"),
        "verified": bool(place.get("verified")),
        "t": place.get("t"),
        "video_day": place.get("video_day"),  # the day the creator's video puts it on, if it does
        "origin": "reel",
    }


@router.post("/reels/imports/{import_id}/build", response_model=MineRead, status_code=201)
async def build_from_reel(
    import_id: uuid.UUID,
    config: MineConfig,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """ "Build my trip" on the Details screen: plan the reel's places for this party. Returns the
    trip (building: poll `/my-trips/{code}` until it is ready)."""
    _check(config)
    job = await session.get(ReelImport, import_id)
    if not job or job.user_id != user.id:
        raise not_found("Import")
    content = await session.get(CreatorContent, job.content_id) if job.content_id else None
    if job.status != ImportStatus.DONE or content is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That reel has not been read yet.")
    mine = await trip_from_import(session, job, content, config)
    return await _read(session, mine)


async def trip_from_import(
    session: AsyncSession, job: ReelImport, content: CreatorContent, config: MineConfig
) -> TravellerTrip:
    """A trip planned from a read reel's places for this party; it builds in the background."""
    creator = await session.get(Creator, content.creator_id) if content.creator_id else None
    stops = [_place_item(p) for p in content.places or [] if p.get("kind") != "area"]
    if not [s for s in stops if s["name"]]:
        raise bad_request("We found no places in that reel to plan a trip around.")
    mine = TravellerTrip(
        code=await _unique_code(session),
        source_import_id=job.id,
        title=f"{content.destination_name or 'Your'} trip".strip(),
        destination_name=content.destination_name,
        summary=str((content.extracted or {}).get("summary") or "")[:500],
        cover_image_key=content.thumbnail_key,
        creator_name=(creator.display_name or creator.handle or "") if creator else "",
        creator_handle=creator.handle if creator else None,
        creator_referral_code=creator.referral_code if creator else "",
        items=stops,
        # What the plan is built from: the stops, and the towns the video travels through.
        source_items=[
            *stops,
            *(_place_item(p) for p in content.places or [] if p.get("kind") == "area"),
        ],
    )
    _apply(mine, config)
    session.add(mine)
    await session.commit()
    await _start(session, mine, quick=config.arya)
    return mine


async def _get(session: AsyncSession, code: str) -> TravellerTrip:
    mine = await session.scalar(
        select(TravellerTrip).where(TravellerTrip.code == code.strip().lower())
    )
    if not mine:
        raise not_found("Trip")
    return mine


@router.get("/my-trips/{code}", response_model=MineRead)
async def read_mine(code: str, session: AsyncSession = Depends(get_session)):
    """Public (the code is the key): a trip made for a traveller, as they left it."""
    return await _read(session, await _get(session, code))


@router.get("/my-trips/{code}/stay-prices", response_model=stay_prices.StayPrices)
async def read_stay_prices(code: str, session: AsyncSession = Depends(get_session)):
    """Live TripJack price of each stay that matches a hotel, for the trip's dates and party.
    Read separately from the trip so the trip opens at once; a stay that is not priced says why."""
    return await stay_prices.stay_prices(session, await _get(session, code))


@router.get("/my-trips/{code}/flight-price", response_model=flight_prices.FlightPrice)
async def read_flight_price(code: str, session: AsyncSession = Depends(get_session)):
    """Live TripJack return fare for the party, from their city to the destination and back on the
    trip's dates. Says why when it cannot be priced (no dates, no from-city, unknown airport)."""
    return await flight_prices.flight_price(await _get(session, code))


@router.patch("/my-trips/{code}", response_model=MineRead)
async def update_mine(code: str, config: MineConfig, session: AsyncSession = Depends(get_session)):
    """Change who is going, the days, the pace or the dates; the code stays the same."""
    _check(config)
    mine = await _get(session, code)
    replan = _apply(mine, config) or mine.build_status == "failed"
    await session.commit()
    if replan:
        await _start(session, mine, quick=config.arya)  # new party, days or pace: planned again
    return await _read(session, mine)


class AryaStart(BaseModel):
    session_id: uuid.UUID
    # The message that opens the chat: the board as the traveller left it, for Arya to plan from.
    message: str


def _companions(mine: TravellerTrip) -> str:
    if mine.group in ("couple", "family", "friends", "seniors", "solo"):
        return mine.group
    if mine.seniors:
        return "seniors"
    if mine.kids:
        return "family"
    return {1: "solo", 2: "couple"}.get(mine.adults, "friends")


def _party_words(mine: TravellerTrip) -> str:
    part = lambda n, one, many: f"{n} {one if n == 1 else many}" if n else ""  # noqa: E731
    return ", ".join(
        w
        for w in (
            part(mine.adults, "adult", "adults"),
            part(mine.kids, "child", "children"),
            part(mine.seniors, "senior", "seniors"),
        )
        if w
    )


def arya_message(mine: TravellerTrip) -> str:
    """The trip board in words: where, for whom, how fast, then the stops day by day."""
    head = (
        f"This is my trip board for {mine.destination_name or 'my trip'}: {mine.days} "
        f"{'day' if mine.days == 1 else 'days'}, {_party_words(mine) or '1 traveller'}, "
        f"{mine.pace} pace"
    )
    head += f", {mine.when_text}." if mine.when_text else "."
    by_day: dict[int, list[str]] = {}
    loose: list[str] = []
    for item in mine.items or []:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        if item.get("day"):
            by_day.setdefault(int(item["day"]), []).append(name)
        else:
            loose.append(name)
    lines = [f"Day {d}: {', '.join(names)}." for d, names in sorted(by_day.items())]
    if loose:
        lines.append(f"Also on the board: {', '.join(loose)}.")
    return (
        head
        + " Keep these stops on the same days and put the plan on the board; I'll tell you what to"
        " change. " + " ".join(lines)
    ).strip()


@router.post("/my-trips/{code}/arya", response_model=AryaStart, status_code=201)
async def chat_with_arya(
    code: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Chat with Arya, from the trip board: a new conversation that already knows the trip (where,
    who, how many days, the pace, the stops), so Arya plans from it instead of asking again."""
    mine = await _get(session, code)
    places = [
        {
            "name": str(i.get("name") or ""),
            "kind": i.get("kind") or "sight",
            "evidence": str(i.get("note") or ""),
            "verified": bool(i.get("verified")),
            "location_name": i.get("name") if i.get("verified") else None,
            "location_id": i.get("location_id"),
        }
        for i in mine.items or []
        if i.get("name")
    ]
    state: dict = {
        "destination": mine.destination_name or None,
        "duration_days": mine.days,
        "companions": _companions(mine),
        "energy_level": {"relaxed": 2, "balanced": 3, "packed": 4}.get(mine.pace, 3),
        "my_trip": mine.code,
        "reel": {
            "import_id": str(mine.source_import_id or ""),
            "url": "",
            "handle": mine.creator_handle or "",
            "summary": mine.summary,
            "places": places,
            "tips": list(mine.tips or []),
        },
    }
    state = {k: v for k, v in state.items() if v not in (None, "")}
    chat = ChatSession(user_id=user.id, title=(mine.title or "My trip")[:255], state=state)
    session.add(chat)
    await session.commit()
    return AryaStart(session_id=chat.id, message=arya_message(mine))


# Location types, as a trip board names them.
_KIND_OF_TYPE = {
    "hotel": "stay",
    "restaurant": "food",
    "activity": "experience",
    "experience": "experience",
    "route": "experience",
}


async def sync_from_chat(session: AsyncSession, code: str, suggestions: list[dict]) -> bool:
    """Arya changed the plan in the chat: put it on the trip board it was started from. Stops that
    are already on the board keep their id, note and place in the reel; new ones come in as
    WishTrip's checked places or as Arya's suggestions. True when the board changed."""
    mine = await session.scalar(select(TravellerTrip).where(TravellerTrip.code == code))
    # A flight or hotel Arya named that we cannot book comes back as a placeholder: it is no stop.
    planned = [
        s
        for s in suggestions
        if str(s.get("name") or "").strip() and s.get("day") and not s.get("is_placeholder")
    ]
    if mine is None or not planned:
        return False
    known = {str(i.get("name") or "").strip().casefold(): i for i in mine.items or []}
    items: list[dict] = []
    for s in sorted(planned, key=lambda s: int(s["day"])):
        name = str(s["name"]).strip()[:200]
        old = known.get(name.casefold())
        if old is not None:
            items.append({**old, "day": int(s["day"])})
            continue
        checked = bool(s.get("from_knowledge_base")) and not s.get("is_placeholder")
        items.append(
            {
                "id": uuid.uuid4().hex,
                "kind": _KIND_OF_TYPE.get(str(s.get("type")), "sight"),
                "name": name,
                "note": str(s.get("why") or "")[:200],
                "day": int(s["day"]),
                "location_id": str(s["location_id"]) if s.get("location_id") else None,
                "verified": checked,
                "t": None,
                "origin": "kb" if checked else "suggested",
            }
        )
    days = min(builder.MAX_DAYS, max(int(i["day"]) for i in items))
    # The chat plans the stops; the journey stays the board's: its flights, transfers, check-out
    # and stays are kept when Arya did not mention them (a stay only where Arya put none).
    named = {str(i["name"]).strip().casefold() for i in items}
    for old in mine.items or []:
        name = str(old.get("name") or "").strip()
        journey = old.get("kind") in ("travel", "stay") or re.match(r"check[- ]?out\b", name, re.I)
        if not journey or name.casefold() in named or int(old.get("day") or 1) > days:
            continue
        if old.get("kind") == "stay" and any(
            i["kind"] == "stay" and i["day"] == old.get("day") for i in items
        ):
            continue
        items.append(dict(old))
    if any(i.get("slot") for i in items):
        items = builder.in_day_order(items)
    if items == list(mine.items or []) and days == mine.days:
        return False
    mine.items, mine.days = items, days
    return True


# --- For staff: which itineraries travellers make their own ------------------------------------


class MineRow(BaseModel):
    code: str
    created_at: datetime
    title: str
    destination: str
    # The itinerary it was made from: a creator's published trip, or a reel the traveller pasted.
    source: str
    source_share_code: str = ""
    creator: str = ""
    party: str
    days: int
    pace: str
    when: str
    group: str
    build_status: str
    ai_built: bool
    arya_chats: int
    stops: int


class MineSource(BaseModel):
    source: str
    source_share_code: str = ""
    creator: str = ""
    destination: str
    made: int
    last_made: datetime


class MineSummary(BaseModel):
    total: int
    from_creator_trips: int
    from_own_reels: int
    talked_to_arya: int
    top_sources: list[MineSource]
    items: list[MineRow]


def _party(t: TravellerTrip) -> str:
    return _party_words(t) or "1 traveller"


@router.get("/admin/mine-trips", response_model=MineSummary)
async def mine_trips(
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_staff),
):
    """Every trip a traveller made their own, newest first: the itinerary it came from, what they
    chose (who, days, pace) and whether they went on to talk to Arya. Plus which itineraries are
    chosen most."""
    from sqlalchemy import func

    rows = list(
        await session.scalars(
            select(TravellerTrip).order_by(TravellerTrip.created_at.desc()).limit(min(limit, 300))
        )
    )
    from sqlalchemy import literal_column

    trip_of = literal_column("chat_sessions.state ->> 'my_trip'")
    chats = dict(
        (
            await session.execute(
                select(trip_of, func.count())
                .select_from(ChatSession)
                .where(trip_of.is_not(None))
                .group_by(trip_of)
            )
        ).all()
    )
    everything = list(await session.scalars(select(TravellerTrip)))
    sources: dict[str, MineSource] = {}
    for t in everything:
        key = t.source_share_code or f"reel:{t.source_import_id}"
        seen = sources.get(key)
        if seen is None:
            sources[key] = MineSource(
                source=t.title,
                source_share_code=t.source_share_code,
                creator=t.creator_handle or t.creator_name,
                destination=t.destination_name,
                made=1,
                last_made=t.created_at,
            )
        else:
            seen.made += 1
            seen.last_made = max(seen.last_made, t.created_at)
    own = sum(1 for t in everything if not t.source_share_code)
    return MineSummary(
        total=len(everything),
        from_creator_trips=len(everything) - own,
        from_own_reels=own,
        talked_to_arya=sum(1 for t in everything if chats.get(t.code)),
        top_sources=sorted(sources.values(), key=lambda s: (-s.made, -s.last_made.timestamp()))[
            :10
        ],
        items=[
            MineRow(
                code=t.code,
                created_at=t.created_at,
                title=t.title,
                destination=t.destination_name,
                source=t.title if t.source_share_code else "A reel they pasted",
                source_share_code=t.source_share_code,
                creator=t.creator_handle or t.creator_name,
                party=_party(t),
                days=t.days,
                pace=t.pace,
                when=t.when_text,
                group=t.group,
                build_status=t.build_status,
                ai_built=t.ai_built,
                arya_chats=int(chats.get(t.code, 0)),
                stops=len(t.items or []),
            )
            for t in rows
        ],
    )
