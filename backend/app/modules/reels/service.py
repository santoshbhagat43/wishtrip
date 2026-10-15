"""Reel → places → a trip plan the traveller can open in chat.

    paste ─▶ ReelImport ─▶ (worker) download ─▶ frames + OCR ─▶ audio + Gemini ─▶ places
                                                                                   │
            chat session seeded with the reel ◀── creator credited ◀── KB matching ◀┘

A reel is processed once (CreatorContent is cached by shortcode); every later paste of the same
reel only creates the traveller's chat session.
"""

import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from collections import Counter
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.openrouter import AIUnavailableError
from app.ai.orchestrator import AIOrchestrator
from app.core.config import settings
from app.modules.chat.models import ChatSession
from app.modules.chat.pipeline import resolve_destination
from app.modules.creators import service as creators
from app.modules.creators import trips as creator_trips
from app.modules.knowledge.models import Location, LocationStatus, LocationType
from app.modules.media.storage import storage
from app.modules.reels import fetch, media
from app.modules.reels.models import (
    CreatorContent,
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


def shortcode_from(url: str) -> str | None:
    match = REEL_URL.match(url.strip())
    return match.group(1) if match else None


def canonical_url(shortcode: str) -> str:
    return f"https://www.instagram.com/reel/{shortcode}/"


def upload_shortcode() -> str:
    """A synthetic id for an uploaded video (there is no Instagram shortcode)."""
    return "upload-" + uuid.uuid4().hex[:16]


# Steps ------------------------------------------------------------------------------------


def download(shortcode: str, workdir: Path) -> dict[str, Any]:
    """instaloader in its own process, killed if Instagram makes it wait too long."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "app.modules.reels.fetch", shortcode, str(workdir)],
            capture_output=True,
            text=True,
            timeout=settings.reel_download_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise ReelError("Instagram took too long to send the reel. Try again in a bit.") from exc
    reason = (result.stderr.strip().splitlines() or [""])[-1]
    if result.returncode == fetch.EXIT_NOT_FOUND:
        raise ReelError("We couldn't open that reel. It may be private or deleted.")
    if result.returncode == fetch.EXIT_NOT_VIDEO:
        raise ReelError("That post has no video. Paste a reel link.")
    if result.returncode == fetch.EXIT_BLOCKED:
        logger.warning("Instagram blocked %s: %s", shortcode, reason)
        raise ReelError("Instagram is not letting us read reels right now. Try again later.")
    if result.returncode != fetch.EXIT_OK:
        logger.warning("Reel download failed for %s: %s", shortcode, reason)
        raise ReelError("We couldn't download that reel. Try again in a bit.")
    return json.loads((workdir / "meta.json").read_text())


def _first(workdir: Path, stem: str) -> Path | None:
    return next(iter(sorted(workdir.glob(f"{stem}.*"))), None)


async def listen(ai: AIOrchestrator, video: Path, workdir: Path, has_audio: bool) -> Transcript:
    if not has_audio or not ai.supports("transcribe"):
        return Transcript()
    try:
        mp3 = media.audio(video, workdir / "audio.mp3").read_bytes()
        return await transcribe(ai, mp3)
    except (media.MediaError, AIUnavailableError, ValueError) as exc:
        # Caption and on-screen text still make a reading; the voice-over is a bonus.
        logger.warning("Transcription failed: %s", exc)
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
        if found is None and city_ids and ai.embedder.name != "hashing":
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

    await step(ImportStep.READING_SCREEN)
    frame_list = media.frames(video, workdir / "frames", settings.reel_max_frames, info.duration)
    ocr_lines = media.ocr(frame_list)

    await step(ImportStep.LISTENING)
    transcript = await listen(ai, video, workdir, info.has_audio)

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
    reading = await read_places(ai, text)
    destination, places = await match_places(session, ai, reading)

    owner = meta.get("owner_username") or ""
    creator = (
        await creators.upsert(session, owner, meta.get("owner_full_name", "")) if owner else None
    )
    cover = thumb or (frame_list[0].path if frame_list else None)
    content = CreatorContent(
        creator_id=creator.id if creator else None,
        shortcode=shortcode,
        url=url,
        caption=meta.get("caption", ""),
        location_tag=meta.get("location", "") or "",
        posted_at=datetime.fromisoformat(meta["posted_at"]) if meta.get("posted_at") else None,
        duration_seconds=info.duration,
        thumbnail_key=storage.save(cover.read_bytes(), cover.name, "reels") if cover else None,
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
        meta = download(shortcode, workdir)
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

    async def step(value: ImportStep) -> None:
        job.status, job.step = ImportStatus.RUNNING, value
        await session.commit()

    try:
        if job.upload_key:
            content = await produce_content_from_upload(
                session, ai, job.shortcode, job.upload_key, on_step=step
            )
        else:
            content = await produce_content(session, ai, job.shortcode, on_step=step)
        if job.kind == ImportKind.CREATOR_TRIP:
            await creator_trips.finish_import(session, job, content)
        else:
            await finish(session, job, content)
    except (ReelError, media.MediaError, AIUnavailableError, ValueError) as exc:
        await session.rollback()
        job = await session.get(ReelImport, job_id, populate_existing=True)
        assert job is not None
        job.status, job.error = ImportStatus.FAILED, _message(exc)
        job.finished_at = datetime.now(UTC)
        await session.commit()


def _message(exc: Exception) -> str:
    if isinstance(exc, ReelError):
        return str(exc)
    logger.warning("Reel import failed: %s", exc)
    return "We couldn't read that reel. Try again, or tell Arya the places instead."


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
