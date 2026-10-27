"""Reel → places → a trip plan the traveller can open in chat.

    paste ─▶ ReelImport ─▶ (worker) download ─▶ frames + OCR ─▶ audio + Gemini ─▶ places
                                                                                   │
            chat session seeded with the reel ◀── creator credited ◀── KB matching ◀┘

A reel is processed once (CreatorContent is cached by shortcode); every later paste of the same
reel only creates the traveller's chat session.
"""

import asyncio
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from collections import Counter
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.chat.models import ChatSession
from app.modules.chat.pipeline import resolve_destination
from app.modules.creators import service as creators
from app.modules.creators import trips as creator_trips
from app.modules.knowledge.models import Location, LocationStatus, LocationType
from app.modules.media.storage import storage
from app.modules.reels import fetch, fetch_youtube, media, saveapi
from app.modules.reels.complete import IncompleteItinerary
from app.modules.reels.models import (
    CreatorContent,
    DownloadRequest,
    ImportKind,
    ImportStatus,
    ImportStep,
    ReelImport,
)
from app.modules.reels.understand import Reading, Transcript, material, read_places, transcribe
from app.modules.search.service import semantic_search
from app.modules.users.models import User

logger = logging.getLogger(__name__)

REEL_URL = re.compile(
    r"^(?:https?://)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)/"
    r"(?:[\w.]+/)?(?:reels?|p|tv)/([A-Za-z0-9_-]{5,40})"
)


class ReelError(RuntimeError):
    """A failure the traveller should read: shown as-is on the reel screen."""


YOUTUBE_PREFIX = "yt-"

# A YouTube video: watch, shorts, live or youtu.be links.
YOUTUBE_VIDEO_URL = re.compile(
    r"^(?:https?://)?(?:(?:www\.|m\.)?youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|live/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?:[?&#/].*)?$",
    re.IGNORECASE,
)


def shortcode_from(url: str) -> str | None:
    """What a pasted link is cached and imported under: an Instagram reel's shortcode, or `yt-<id>`
    for a YouTube video (a Short or an ordinary video)."""
    url = url.strip()
    match = REEL_URL.match(url)
    if match:
        return match.group(1)
    video = YOUTUBE_VIDEO_URL.match(url)
    return YOUTUBE_PREFIX + video.group(1) if video else None


def youtube_shortcode(video_id: str) -> str:
    """The id a YouTube video is cached under (never clashes with an Instagram shortcode)."""
    return YOUTUBE_PREFIX + video_id


def canonical_url(shortcode: str) -> str:
    if shortcode.startswith(YOUTUBE_PREFIX):
        return f"https://www.youtube.com/watch?v={shortcode[len(YOUTUBE_PREFIX) :]}"
    return f"https://www.instagram.com/reel/{shortcode}/"


def upload_shortcode() -> str:
    """A synthetic id for an uploaded video (there is no Instagram shortcode)."""
    return "upload-" + uuid.uuid4().hex[:16]


# Steps ------------------------------------------------------------------------------------


@dataclass
class Attempt:
    """One try at downloading, kept as a `DownloadRequest` whether or not it worked."""

    provider: str  # instaloader | yt-dlp | saveapi
    platform: str  # instagram | youtube
    url: str
    shortcode: str
    ok: bool = False
    error_code: str = ""
    error_message: str = ""
    duration_ms: int = 0
    bytes: int | None = None
    credits_spent: float | None = None
    credits_remaining: float | None = None


# Where `download` leaves its attempts for the caller that will record them, so `download` keeps
# its plain (shortcode, workdir) shape.
_attempts: ContextVar[list[Attempt] | None] = ContextVar("download_attempts", default=None)
# The import being processed, so each download attempt can say which one it was for.
_current_import: ContextVar[uuid.UUID | None] = ContextVar("current_import", default=None)
# The running import's log; process() saves it on the job at each step and at the end.
_events: ContextVar[list | None] = ContextVar("import_events", default=None)


def note(message: str, **extra: Any) -> None:
    """Add a line to the running import's log (staff read it in the dashboard)."""
    events = _events.get()
    if events is not None:
        events.append({"at": datetime.now(UTC).isoformat(), "message": message, **extra})


# Our own download failing in these ways is worth asking SaveAPI about. Private, deleted, not a
# video or too long would fail there too (and a failed lookup still costs credits).
_ASK_SAVEAPI = {fetch.EXIT_BLOCKED, fetch.EXIT_FAILED}
# SaveAPI problems that are ours to fix, not the creator's: say so in the logs, show the original
# failure to them.
_SAVEAPI_OURS = {
    "MISSING_API_KEY", "INVALID_API_KEY", "KEY_REVOKED", "KEY_EXPIRED", "ACCOUNT_SUSPENDED",
    "IP_NOT_ALLOWED", "PLATFORM_NOT_ALLOWED", "QUOTA_EXCEEDED",
}  # fmt: skip


def _primary_error(code: int | None, youtube: bool) -> ReelError:
    """What to tell the creator when our own download failed (`code` None = it timed out)."""
    site = "YouTube" if youtube else "Instagram"
    if code is None:
        return ReelError(f"{site} took too long to send it. Try again in a bit.")
    if code == fetch.EXIT_NOT_FOUND:
        return ReelError(
            "We couldn't open that video. It may be private, age-restricted or removed."
            if youtube
            else "We couldn't open that reel. It may be private or deleted."
        )
    if code == fetch.EXIT_NOT_VIDEO:
        return ReelError(
            "That's a live stream. Paste a link to a finished video."
            if youtube
            else "That post has no video. Paste a reel link."
        )
    if code == fetch_youtube.EXIT_TOO_LONG:
        return ReelError(
            f"That video is longer than {settings.reel_max_seconds // 60} minutes. "
            "Use a shorter one."
        )
    if code == fetch.EXIT_BLOCKED:
        return ReelError(
            "YouTube is not letting us read videos right now. Try again later, or upload the "
            "video instead."
            if youtube
            else "Instagram is not letting us read reels right now. Try again later."
        )
    return ReelError("We couldn't download that video. Try again in a bit.")


def _saveapi_error(exc: saveapi.SaveApiError, youtube: bool) -> ReelError | None:
    """The creator-facing meaning of a SaveAPI failure, when it says something our own failure
    did not (the post is private or gone, the video is too long…); else None."""
    if exc.code in {"PRIVATE_CONTENT", "MEDIA_NOT_FOUND"}:
        return _primary_error(fetch.EXIT_NOT_FOUND, youtube)
    if exc.code == "TOO_LONG":
        return _primary_error(fetch_youtube.EXIT_TOO_LONG, youtube)
    if exc.code == "FILE_TOO_LARGE":
        return ReelError(f"That video is over {settings.reel_upload_max_mb} MB. Use a shorter one.")
    return None


def _ask_saveapi(shortcode: str, workdir: Path, youtube: bool, attempts: list[Attempt]) -> dict:
    """Fetch with SaveAPI (Instagram's way in; YouTube's when our own download failed) and record
    the try. Raises SaveApiError."""
    url = canonical_url(shortcode)
    attempt = Attempt("saveapi", "youtube" if youtube else "instagram", url, shortcode)
    attempts.append(attempt)
    started = time.monotonic()
    try:
        fetched = (saveapi.fetch_youtube if youtube else saveapi.fetch_instagram)(url, workdir)
    except saveapi.SaveApiError as exc:
        attempt.error_code, attempt.error_message = exc.code, exc.message
        attempt.duration_ms = int((time.monotonic() - started) * 1000)
        if exc.code in _SAVEAPI_OURS:
            logger.error(
                "SaveAPI refused us (%s): %s. Check the key and the credit balance.",
                exc.code,
                exc.message,
            )
        else:
            logger.warning("SaveAPI could not fetch %s: %s", shortcode, exc)
        raise
    attempt.ok = True
    attempt.duration_ms = int((time.monotonic() - started) * 1000)
    attempt.bytes = fetched.bytes
    attempt.credits_spent, attempt.credits_remaining = (
        fetched.credits_spent,
        fetched.credits_remaining,
    )
    logger.info("SaveAPI fetched %s (%s credits left)", shortcode, fetched.credits_remaining)
    return fetched.meta


def download(
    shortcode: str, workdir: Path, attempts: list[Attempt] | None = None
) -> dict[str, Any]:
    """The reel or video. Instagram comes from SaveAPI (when it is set up). YouTube comes from our
    own tool first, in its own process and killed if the site makes it wait too long; then, if
    that failed in a way another route might get round, from SaveAPI.
    Every try is appended to `attempts` (by default the list `produce_content` is keeping)."""
    if attempts is None:
        attempts = _attempts.get()
    if attempts is None:
        attempts = []
    youtube = shortcode.startswith(YOUTUBE_PREFIX)
    if not youtube and settings.instagram_via_saveapi and saveapi.enabled():
        # Instagram: SaveAPI only. It answers in about two seconds where our own download takes
        # ten or more, and needs no signed-in Instagram session. It gives no caption, so the
        # reading rests on the screen and the voice-over.
        try:
            return _ask_saveapi(shortcode, workdir, False, attempts)
        except saveapi.SaveApiError as exc:
            raise (
                _saveapi_error(exc, False)
                or ReelError("We couldn't download that reel. Try again in a bit.")
            ) from exc
    module = "app.modules.reels.fetch_youtube" if youtube else "app.modules.reels.fetch"
    target = canonical_url(shortcode) if youtube else shortcode
    attempt = Attempt(
        "yt-dlp" if youtube else "instaloader",
        "youtube" if youtube else "instagram",
        canonical_url(shortcode),
        shortcode,
    )
    attempts.append(attempt)
    started = time.monotonic()
    code: int | None = None
    reason = ""
    try:
        result = subprocess.run(
            [sys.executable, "-m", module, target, str(workdir)],
            capture_output=True,
            text=True,
            timeout=settings.reel_download_timeout_seconds,
        )
        code = result.returncode
        reason = (result.stderr.strip().splitlines() or [""])[-1]
    except subprocess.TimeoutExpired:
        reason = "timed out"
    attempt.duration_ms = int((time.monotonic() - started) * 1000)
    if code == fetch.EXIT_OK:
        attempt.ok = True
        return json.loads((workdir / "meta.json").read_text())
    attempt.error_code = "TIMEOUT" if code is None else f"EXIT_{code}"
    attempt.error_message = reason[:500]
    logger.warning("%s download failed for %s: %s", attempt.provider, shortcode, reason)

    if (code is None or code in _ASK_SAVEAPI) and saveapi.enabled():
        try:
            return _ask_saveapi(shortcode, workdir, youtube, attempts)
        except saveapi.SaveApiError as exc:
            raise (_saveapi_error(exc, youtube) or _primary_error(code, youtube)) from exc
    raise _primary_error(code, youtube)


async def record_attempts(attempts: list[Attempt]) -> None:
    """Keep a row per download attempt. Its own short session: a failed import rolls the main
    one back, and a failure is exactly what we want on record."""
    if not attempts:
        return
    try:
        async with SessionLocal() as session:
            session.add_all(
                DownloadRequest(
                    import_id=_current_import.get(),
                    provider=a.provider,
                    platform=a.platform,
                    source_url=a.url[:1000],
                    shortcode=a.shortcode,
                    ok=a.ok,
                    error_code=a.error_code,
                    error_message=a.error_message,
                    duration_ms=a.duration_ms,
                    bytes=a.bytes,
                    credits_spent=a.credits_spent,
                    credits_remaining=a.credits_remaining,
                )
                for a in attempts
            )
            await session.commit()
    except Exception:  # noqa: BLE001 - a missing log row must never sink the import itself
        logger.exception("Could not record the download attempts")


def _first(workdir: Path, stem: str) -> Path | None:
    return next(iter(sorted(workdir.glob(f"{stem}.*"))), None)


async def listen(ai: AIOrchestrator, video: Path, workdir: Path, has_audio: bool) -> Transcript:
    if not has_audio or not ai.supports("transcribe"):
        return Transcript()
    try:
        mp3 = (await asyncio.to_thread(media.audio, video, workdir / "audio.mp3")).read_bytes()
    except media.MediaError as exc:
        logger.warning("Audio extraction failed: %s", exc)
        return Transcript()
    # One retry: the model now and then returns malformed JSON for a long transcript, and that
    # used to drop the whole voice-over.
    for attempt in (1, 2):
        try:
            return await transcribe(ai, mp3)
        except (AIUnavailableError, ValueError) as exc:
            logger.warning("Transcription failed (try %d): %s", attempt, exc)
    # Caption and on-screen text still make a reading; the voice-over is a bonus.
    return Transcript()


def _norm(text: str) -> str:
    return re.sub(r"[\W_]+", " ", text.lower()).strip()


# Words that say what a place is, not which one: "Cafe Bodega" is not "Cafe Bhonsle".
GENERIC = {
    "cafe", "restaurant", "beach", "fort", "hotel", "resort", "villa", "market", "temple",
    "church", "lake", "bar", "bistro", "kitchen", "house", "view", "viewpoint", "point",
    "island", "falls", "trek", "tour", "cruise", "north", "south", "east", "west", "old", "new",
}  # fmt: skip


def _distinct(text: str) -> set[str]:
    return {w for w in _norm(text).split() if len(w) >= 4 and w not in GENERIC}


def _shares_name(a: str, b: str) -> bool:
    """Some distinctive word in common, allowing for a transcription slip ("Thalaser")."""
    return any(
        SequenceMatcher(None, x, y).ratio() >= 0.7 for x in _distinct(a) for y in _distinct(b)
    )


def _same_place(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    if a == b or (min(len(a), len(b)) >= 5 and (a in b or b in a)):
        return True
    wa, wb = set(a.split()), set(b.split())
    return len(wa & wb) / len(wa | wb) >= 0.6


async def match_places(
    session: AsyncSession, ai: AIOrchestrator, reading: Reading
) -> tuple[Location | None, list[dict[str, Any]]]:
    """Each place → its knowledge-base entry when we have one (verified), else kept as
    'from the reel' so the planner never presents it as checked."""
    destination, city_ids = await resolve_destination(session, reading.destination)
    if destination is None and reading.country:
        destination, city_ids = await resolve_destination(session, reading.country)
    published = Location.status == LocationStatus.PUBLISHED
    stops = Location.type.not_in([LocationType.CITY, LocationType.COUNTRY])
    scope = [published, stops]
    if city_ids:
        scope.append(Location.parent_id.in_(city_ids))
    search_by_meaning = bool(city_ids) and ai.embedder.name != "hashing"
    if search_by_meaning:
        # A place not found by name is looked up by meaning: embed every name at once, up front,
        # rather than one embedding call per place.
        try:
            await ai.embed_queries([f"{p['name']} {reading.destination}" for p in reading.places])
        except Exception:  # noqa: BLE001 - each lookup below then embeds its own name
            logger.warning("Could not embed the place names in one go", exc_info=True)
    out: list[dict[str, Any]] = []
    for place in reading.places:
        name = place["name"]
        key = _norm(name)
        words = [w for w in key.split() if len(w) >= 4] or key.split()
        rows = await session.scalars(
            select(Location).where(
                *scope,
                or_(
                    *(func.lower(Location.name).contains(w) for w in words),
                    func.lower(func.array_to_string(Location.aliases, " ")).contains(key),
                ),
            )
        )
        found = next(
            (
                loc
                for loc in rows.unique()
                if _same_place(name, loc.name) or any(_same_place(name, a) for a in loc.aliases)
            ),
            None,
        )
        if found is None and search_by_meaning:
            hits = await semantic_search(
                session, ai, f"{name} {reading.destination}", city_ids=city_ids, limit=1,
                min_similarity=0.8,
            )  # fmt: skip
            # A close vector alone is not proof: the names must share a distinctive word.
            if hits and _shares_name(name, hits[0].location.name):
                found = hits[0].location
        if found is not None and any(p["location_id"] == str(found.id) for p in out):
            continue  # said and shown: one place, keep its first mention
        if found is None and any(_shares_name(name, p["name"]) for p in out if not p["verified"]):
            continue
        out.append(
            {
                **place,
                "verified": found is not None,
                "location_id": str(found.id) if found else None,
                "location_name": found.name if found else None,
                "location_type": found.type.value if found else None,
            }
        )
    if destination is None or destination.type != LocationType.CITY:
        # "North Goa" is not a city we know, but the places it names are: use their city.
        parents: Counter[uuid.UUID] = Counter()
        for p in (p for p in out if p["verified"]):
            loc = await session.get(Location, uuid.UUID(p["location_id"]))
            if loc and loc.parent_id:
                parents[loc.parent_id] += 1
        if parents:
            city = await session.get(Location, parents.most_common(1)[0][0])
            destination = city if city and city.type == LocationType.CITY else destination
    return destination, out


StepCallback = Callable[[ImportStep], Awaitable[None]]


UPLOAD_META = {
    "owner_username": "",
    "owner_full_name": "",
    "caption": "",
    "hashtags": [],
    "location": "",
    "posted_at": None,
}


# Where the frames kept for cover choice live in storage.
FRAMES = "reels/frames"


def _read_screen(
    video: Path, workdir: Path, duration: float
) -> tuple[list[media.Frame], list[dict]]:
    frame_list = media.frames(video, workdir / "frames", settings.reel_max_frames, duration)
    return frame_list, media.ocr(frame_list)


async def _read_into_content(
    session: AsyncSession,
    ai: AIOrchestrator,
    *,
    shortcode: str,
    url: str,
    video: Path,
    meta: dict,
    workdir: Path,
    thumb: Path | None,
    step: StepCallback,
) -> CreatorContent:
    """Shared: read a video (frames, OCR, voice-over) into a CreatorContent row."""
    info = media.probe(video)
    if info.duration > settings.reel_max_seconds:
        raise ReelError(
            f"That video is longer than {settings.reel_max_seconds // 60} minutes. "
            "Try a shorter reel."
        )

    # The screen (frames, then OCR: CPU, minutes) and the voice-over (audio, then a Gemini call:
    # network) don't need each other, so they run at the same time. Both stay off the event loop.
    await step(ImportStep.READING_SCREEN)
    started = time.perf_counter()

    async def listen_timed() -> Transcript:
        began = time.perf_counter()
        heard = await listen(ai, video, workdir, info.has_audio)
        note(
            f"Voice-over: {len(heard.text.split())} words"
            + (f" in {heard.language}" if heard.language else "")
            if heard.text
            else "Voice-over: none heard",
            seconds=round(time.perf_counter() - began, 1),
        )
        return heard

    note(
        f"Video: {info.duration:.0f}s, {'with' if info.has_audio else 'no'} audio",
        seconds=round(info.duration, 1),
    )
    listening = asyncio.create_task(listen_timed())
    try:
        frame_list, ocr_lines = await asyncio.to_thread(_read_screen, video, workdir, info.duration)
    except BaseException:
        listening.cancel()
        raise
    screen_done = time.perf_counter()
    note(
        f"Screen: {len(frame_list)} frames, {len(ocr_lines)} lines of text read",
        seconds=round(screen_done - started, 1),
    )
    transcript = await listening
    logger.info(
        "Reel %s: %.0fs video, %d frames, %d OCR lines; screen %.1fs, then waited %.1fs more "
        "for the voice-over",
        shortcode, info.duration, len(frame_list), len(ocr_lines),
        screen_done - started, time.perf_counter() - screen_done,
    )  # fmt: skip

    await step(ImportStep.FINDING_PLACES)
    text = material(
        meta.get("caption", ""),
        meta.get("hashtags", []),
        meta.get("location", ""),
        ocr_lines,
        transcript,
    )
    if not ai.enabled:
        raise ReelError("Reading reels needs the AI service, which is not set up.")
    reading = await read_places(ai, text, ocr_lines)
    note(
        f"Places read: {len(reading.places)}"
        + (f"; destination {reading.destination}" if reading.destination else "")
    )
    destination, places = await match_places(session, ai, reading)
    note(
        f"Matched to our knowledge: {sum(1 for p in places if p.get('verified'))} of {len(places)}"
    )

    owner = meta.get("owner_username") or ""
    creator = (
        await creators.upsert(session, owner, meta.get("owner_full_name", "")) if owner else None
    )
    cover = thumb or (frame_list[0].path if frame_list else None)
    kept = media.spread(frame_list, settings.reel_cover_frames)
    content = CreatorContent(
        creator_id=creator.id if creator else None,
        shortcode=shortcode,
        url=url,
        caption=meta.get("caption", ""),
        location_tag=meta.get("location", "") or "",
        posted_at=datetime.fromisoformat(meta["posted_at"]) if meta.get("posted_at") else None,
        duration_seconds=info.duration,
        thumbnail_key=storage.save(cover.read_bytes(), cover.name, "reels") if cover else None,
        frames=[
            {"t": round(f.t, 1), "key": storage.save(f.path.read_bytes(), f.path.name, FRAMES)}
            for f in kept
        ],
        ocr_lines=ocr_lines,
        transcript=transcript.text,
        transcript_language=transcript.language,
        transcript_en=transcript.english,
        extracted=reading.to_dict(),
        places=places,
        destination_id=destination.id if destination else None,
        destination_name=destination.name if destination else reading.destination,
    )
    session.add(content)
    await session.flush()
    return content


def _stepper(on_step: StepCallback | None) -> StepCallback:
    async def step(value: ImportStep) -> None:
        if on_step is not None:
            await on_step(value)

    return step


async def produce_content(
    session: AsyncSession,
    ai: AIOrchestrator,
    shortcode: str,
    on_step: StepCallback | None = None,
) -> CreatorContent:
    """Download an Instagram reel and read it into a CreatorContent row (cached by shortcode)."""
    cached_content = await cached(session, shortcode)
    if cached_content is not None:
        return cached_content
    step = _stepper(on_step)
    workdir = Path(tempfile.mkdtemp(prefix=f"reel-{shortcode}-"))
    try:
        await step(ImportStep.DOWNLOADING)
        attempts: list[Attempt] = []
        token = _attempts.set(attempts)
        try:
            meta = download(shortcode, workdir)
        finally:
            _attempts.reset(token)
            await record_attempts(attempts)
        video = _first(workdir, "reel")
        if video is None:
            raise ReelError("We couldn't download that reel. Try again in a bit.")
        return await _read_into_content(
            session,
            ai,
            shortcode=shortcode,
            url=canonical_url(shortcode),
            video=video,
            meta=meta,
            workdir=workdir,
            thumb=_first(workdir, "thumb"),
            step=step,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def produce_content_from_upload(
    session: AsyncSession,
    ai: AIOrchestrator,
    shortcode: str,
    upload_key: str,
    on_step: StepCallback | None = None,
) -> CreatorContent:
    """Read an uploaded video file into a CreatorContent row (no Instagram download)."""
    step = _stepper(on_step)
    src = Path(storage.root) / upload_key
    workdir = Path(tempfile.mkdtemp(prefix="reel-upload-"))
    try:
        await step(ImportStep.DOWNLOADING)
        if not src.exists():
            raise ReelError("We couldn't find your uploaded video. Try again.")
        video = workdir / f"reel{src.suffix.lower() or '.mp4'}"
        shutil.copy(src, video)
        return await _read_into_content(
            session,
            ai,
            shortcode=shortcode,
            url="",
            video=video,
            meta=dict(UPLOAD_META),
            workdir=workdir,
            thumb=None,
            step=step,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        storage.delete(upload_key)  # keep no raw upload; only the cover + text remain


async def process(session: AsyncSession, ai: AIOrchestrator, job: ReelImport) -> None:
    """Run one import to the end. Errors land on the job for the person to read."""
    job_id = job.id
    _current_import.set(job_id)

    events: list = list(job.log or [])
    _events.set(events)
    events.append(
        {"at": datetime.now(UTC).isoformat(), "step": "started", "message": "Picked up by a worker"}
    )

    async def step(value: ImportStep) -> None:
        events.append({"at": datetime.now(UTC).isoformat(), "step": value.value})
        job.status, job.step, job.log = ImportStatus.RUNNING, value, list(events)
        await session.commit()

    try:
        if job.upload_key:
            content = await produce_content_from_upload(
                session, ai, job.shortcode, job.upload_key, on_step=step
            )
        else:
            content = await produce_content(session, ai, job.shortcode, on_step=step)
        job.log = list(events)
        if job.kind == ImportKind.CREATOR_TRIP:
            if not any(p.get("kind") != "area" for p in content.places):
                raise ReelError(
                    "We couldn't find any places in that reel. Does it name them in the caption, "
                    "on screen or out loud?"
                )
            await creator_trips.finish_import(session, job, content, ai)
        else:
            await finish(session, job, content)
    except Exception as exc:  # noqa: BLE001 - whatever goes wrong, the job must end, not hang
        await session.rollback()
        job = await session.get(ReelImport, job_id, populate_existing=True)
        assert job is not None
        job.status, job.error = ImportStatus.FAILED, _message(exc)
        job.finished_at = datetime.now(UTC)
        events.append(
            {
                "at": job.finished_at.isoformat(),
                "step": "failed",
                "message": f"{type(exc).__name__}: {exc}"[:500],
            }
        )
        job.log = list(events)
        await session.commit()


def _message(exc: Exception) -> str:
    if isinstance(exc, ReelError | IncompleteItinerary):
        return str(exc)
    logger.exception("Reel import failed", exc_info=exc)
    return "We couldn't read that reel. Try again in a bit, or tell Arya the places instead."


async def cached(session: AsyncSession, shortcode: str) -> CreatorContent | None:
    return await session.scalar(select(CreatorContent).where(CreatorContent.shortcode == shortcode))


def seed_message(content: CreatorContent, handle: str) -> str:
    """What the traveller sends to start planning: the reel's places in plain words."""
    names = [p["location_name"] or p["name"] for p in content.places if p.get("kind") != "area"]
    where = content.destination_name or "this trip"
    days = (content.extracted or {}).get("days_hint")
    source = f"@{handle}'s reel" if handle else "this video"
    text = f"Plan a trip to {where} based on {source}"
    if days:
        text += f", about {days} days"
    if names:
        text += ". I want to see: " + ", ".join(names[:10])
    return text + "."


async def finish(session: AsyncSession, job: ReelImport, content: CreatorContent) -> None:
    """Give the traveller a chat session seeded with the reel, and credit the creator."""
    user = await session.get(User, job.user_id)
    assert user is not None
    creator = (
        await session.get(creators.Creator, content.creator_id) if content.creator_id else None
    )
    handle = creator.handle if creator else ""
    reel = {
        "import_id": str(job.id),
        "url": content.url,
        "handle": handle,
        "summary": (content.extracted or {}).get("summary", ""),
        "places": content.places,
        "tips": (content.extracted or {}).get("tips", []),
    }
    state: dict[str, Any] = {"reel": reel}
    if content.destination_name:
        state["destination"] = content.destination_name
    days = (content.extracted or {}).get("days_hint")
    if days:
        state["duration_days"] = days
    title = content.destination_name or "Trip"
    title = f"{title} from @{handle}’s reel" if handle else f"{title} from your video"
    chat = ChatSession(user_id=user.id, title=title[:255], state=state)
    session.add(chat)
    await session.flush()
    if creator is not None:
        await creators.credit_reel(session, user, creator, content.id)
    job.content_id, job.chat_session_id = content.id, chat.id
    job.status, job.step, job.error = ImportStatus.DONE, ImportStep.DONE, ""
    job.finished_at = datetime.now(UTC)
    await session.commit()


async def recent_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    since = datetime.now(UTC) - timedelta(hours=1)
    return (
        await session.scalar(
            select(func.count()).where(ReelImport.user_id == user_id, ReelImport.created_at > since)
        )
        or 0
    )
