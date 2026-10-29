"""SaveAPI (api.saveapi.org): the fallback when our own download of a reel or video fails.

Our own download (instaloader for Instagram, yt-dlp for YouTube) is free but sometimes refused:
Instagram wants a fresh login, and YouTube refuses most server addresses. SaveAPI resolves a public
link into a direct file URL; we then fetch the file ourselves and hand it to the same reading
steps. It is paid per request (about 1.5 credits for an Instagram reel, 2 + 10 for a YouTube
video), so it is only ever tried after our own download has failed, and every attempt is recorded
(see `DownloadRequest`).

    https://api.saveapi.org/v1/download?url=…            Instagram: medias[], meta
    https://api.saveapi.org/v1/youtube/info?url=…        YouTube: title, duration, qualities
    https://api.saveapi.org/v1/youtube/create?url=…&quality=480p   YouTube: a direct file URL
"""

import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import settings

# What YouTube asks for: enough to read text off and listen to, and the cheapest to fetch.
YOUTUBE_QUALITY = "480p"
# Failures a second try can fix; anything else (private, deleted, no credits…) will not improve.
RETRYABLE = {"UPSTREAM_TIMEOUT", "UPSTREAM_ERROR", "RATE_LIMITED"}
MAX_RATE_LIMIT_WAIT = 10  # seconds; a longer Retry-After isn't worth holding the worker for

HASHTAG = re.compile(r"#(\w{2,40})")


class SaveApiError(RuntimeError):
    """SaveAPI refused or failed. `code` is its stable error code (branch on it, not the text)."""

    def __init__(self, code: str, message: str = "", *, http_status: int | None = None) -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message
        self.http_status = http_status


@dataclass
class Fetched:
    """What one successful SaveAPI download left in the work folder, and what it cost."""

    meta: dict[str, Any]
    # SaveAPI's answers as they came (see `scrub`), for the download log.
    raw: dict[str, Any] = field(default_factory=dict)
    bytes: int = 0
    credits_spent: float | None = None
    credits_remaining: float | None = None
    calls: list[str] = field(default_factory=list)


def enabled() -> bool:
    return bool(settings.saveapi_key)


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=settings.saveapi_url,
        headers={"Authorization": f"Bearer {settings.saveapi_key}", "Accept": "application/json"},
        timeout=httpx.Timeout(45, connect=10),
    )


def _cdn() -> httpx.Client:
    """For the file itself, which lives on the source's own CDN: no SaveAPI key goes there."""
    return httpx.Client(timeout=httpx.Timeout(60, connect=10), follow_redirects=True)


def _get(client: httpx.Client, path: str, params: dict[str, Any]) -> dict[str, Any]:
    """One GET, retried once for the failures a retry can fix (as SaveAPI's own SDKs do)."""
    for attempt in (1, 2):
        try:
            res = client.get(path, params=params)
        except httpx.TimeoutException as exc:
            error = SaveApiError("UPSTREAM_TIMEOUT", str(exc))
        except httpx.HTTPError as exc:
            error = SaveApiError("UPSTREAM_ERROR", str(exc))
        else:
            body = (
                res.json()
                if res.headers.get("content-type", "").startswith("application/json")
                else {}
            )
            if res.status_code == 200 and body.get("success"):
                return body
            detail = body.get("error") or {}
            error = SaveApiError(
                str(detail.get("code") or "HTTP_ERROR"),
                str(detail.get("message") or res.reason_phrase),
                http_status=res.status_code,
            )
            retry_after = res.headers.get("Retry-After", "")
            if error.code == "RATE_LIMITED" and retry_after.isdigit():
                if int(retry_after) > MAX_RATE_LIMIT_WAIT:
                    raise error
                time.sleep(int(retry_after))
                if attempt == 1:
                    continue
        if attempt == 2 or error.code not in RETRYABLE:
            raise error
        time.sleep(1)
    raise AssertionError("unreachable")  # pragma: no cover


def _save_file(cdn: httpx.Client, url: str, dest: Path, max_bytes: int) -> int:
    """Stream a direct file URL to disk, refusing anything over `max_bytes`."""
    deadline = time.monotonic() + settings.reel_download_timeout_seconds
    size = 0
    try:
        with cdn.stream("GET", url) as res:
            if res.status_code != 200:
                raise SaveApiError("DOWNLOAD_FAILED", f"the file answered {res.status_code}")
            with dest.open("wb") as out:
                for chunk in res.iter_bytes(1024 * 256):
                    size += len(chunk)
                    if size > max_bytes:
                        raise SaveApiError(
                            "FILE_TOO_LARGE", f"over {max_bytes // (1024 * 1024)} MB"
                        )
                    if time.monotonic() > deadline:
                        raise SaveApiError("UPSTREAM_TIMEOUT", "the file took too long to arrive")
                    out.write(chunk)
    except httpx.HTTPError as exc:
        raise SaveApiError("DOWNLOAD_FAILED", str(exc)) from exc
    if size == 0:
        raise SaveApiError("DOWNLOAD_FAILED", "the file was empty")
    return size


def _save_thumbnail(cdn: httpx.Client, url: str | None, workdir: Path) -> None:
    """The cover picture is a nicety: never fail a reel over it."""
    if not url:
        return
    suffix = Path(urlparse(url).path).suffix.lower()
    suffix = suffix if suffix in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"
    try:
        res = cdn.get(url, timeout=20)
        if res.status_code == 200 and res.content:
            (workdir / f"thumb{suffix}").write_bytes(res.content)
    except httpx.HTTPError:
        pass


def _iso(epoch: Any) -> str | None:
    return (
        datetime.fromtimestamp(int(epoch), UTC).isoformat()
        if isinstance(epoch, int | float)
        else None
    )


def scrub(body: dict[str, Any]) -> dict[str, Any]:
    """SaveAPI's answer as staff read it back: all of it, except the links to the video files
    (they carry signed tokens and expire)."""
    out = {k: v for k, v in body.items() if k != "success"}
    if isinstance(out.get("medias"), list):
        out["medias"] = [
            {k: v for k, v in m.items() if k != "url"} for m in out["medias"] if isinstance(m, dict)
        ]
    if isinstance(out.get("url"), str):
        out["url"] = "(file link, not kept)"
    return out


_SKIP_KEYS = ("url", "credits", "download", "token", "signature", "thumbnail")


def instagram_source(body: dict[str, Any]) -> dict[str, Any]:
    """What SaveAPI says about the post, as staff read it: who made it, how it did, where and
    when, the music. The expiring CDN links (video, cover, avatar) are left out."""
    meta = body.get("meta") or {}
    music = meta.get("music") or {}
    out: dict[str, Any] = {
        "platform": "instagram",
        "source": "saveapi",
        "source_url": body.get("source_url"),
        "video_id": body.get("video_id"),
        "title": meta.get("title"),
        "author": meta.get("author"),
        "username": meta.get("username"),
        "author_url": meta.get("author_url"),
        "author_verified": meta.get("author_verified"),
        "duration": meta.get("duration"),
        "views": meta.get("views"),
        "likes": meta.get("likes"),
        "comments": meta.get("comments"),
        "shares": meta.get("shares"),
        "saves": meta.get("saves"),
        "location": meta.get("location"),
        "region": meta.get("region"),
        "published_at": _iso(meta.get("published_at")),
        "music": (
            {k: music.get(k) for k in ("title", "author", "original") if music.get(k) is not None}
            or None
        ),
    }
    return {k: v for k, v in out.items() if v not in (None, "")}


def youtube_source(*answers: dict[str, Any]) -> dict[str, Any]:
    """What SaveAPI says about a YouTube video: every plain value in its answers (title, channel,
    length, counts…) except links, which expire, and the credit counts."""
    out: dict[str, Any] = {"platform": "youtube", "source": "saveapi"}
    for answer in answers:
        for key, value in answer.items():
            if any(w in key.lower() for w in _SKIP_KEYS) or key == "success":
                continue
            if isinstance(value, str | int | float | bool) and value != "":
                out[key] = value[:2000] if isinstance(value, str) else value
    return out


def _credits(body: dict[str, Any]) -> tuple[float | None, float | None]:
    credits = body.get("credits") or {}
    return credits.get("spent"), credits.get("remaining")


@dataclass
class Looked:
    """SaveAPI's answer about an Instagram post, before any file is fetched: what the creator wrote
    and where the video is. The lookup is the paid part; the file comes free from Instagram's own
    CDN, so deciding from the caption first costs nothing extra."""

    meta: dict[str, Any]
    raw: dict[str, Any]
    video_url: str
    thumbnail_url: str | None = None
    credits_spent: float | None = None
    credits_remaining: float | None = None
    calls: list[str] = field(default_factory=lambda: ["/v1/download"])


def look_up_instagram(url: str, client: httpx.Client | None = None) -> Looked:
    """Ask SaveAPI about an Instagram reel by its link (no file is fetched)."""
    opened = client is None
    client = client or _client()
    try:
        body = _get(client, "/v1/download", {"url": url})
    finally:
        if opened:
            client.close()
    video = next((m for m in body.get("medias") or [] if m.get("type") == "video"), None)
    if video is None:
        raise SaveApiError("MEDIA_NOT_FOUND", "the post has no video", http_status=404)
    meta = body.get("meta") or {}
    caption = str(meta.get("text") or meta.get("title") or "")
    where = ", ".join(str(x) for x in (meta.get("location"), meta.get("region")) if x)
    spent, remaining = _credits(body)
    return Looked(
        meta={
            "shortcode": body.get("video_id") or "",
            "owner_username": meta.get("username") or "",
            "owner_full_name": meta.get("author") or "",
            "caption": caption,
            "hashtags": HASHTAG.findall(caption)[:30],
            "location": where,
            "posted_at": _iso(meta.get("published_at")),
            "duration": meta.get("duration"),
            "source": instagram_source(body),
        },
        raw=scrub(body),
        video_url=video["url"],
        thumbnail_url=meta.get("thumbnail"),
        credits_spent=spent,
        credits_remaining=remaining,
    )


def save_cover(looked: Looked, workdir: Path, cdn: httpx.Client | None = None) -> None:
    """Only the cover picture, for a reel read from its caption alone."""
    opened = cdn is None
    cdn = cdn or _cdn()
    try:
        _save_thumbnail(cdn, looked.thumbnail_url, workdir)
    finally:
        if opened:
            cdn.close()


def save_video(looked: Looked, workdir: Path, cdn: httpx.Client | None = None) -> int:
    """The video file and the cover, once the caption wasn't enough. Returns the size."""
    opened = cdn is None
    cdn = cdn or _cdn()
    try:
        size = _save_file(
            cdn, looked.video_url, workdir / "reel.mp4", settings.reel_upload_max_mb * 1024 * 1024
        )
        _save_thumbnail(cdn, looked.thumbnail_url, workdir)
        return size
    finally:
        if opened:
            cdn.close()


def fetch_instagram(
    url: str,
    workdir: Path,
    client: httpx.Client | None = None,
    cdn: httpx.Client | None = None,
) -> Fetched:
    """An Instagram reel by its link: the video, its cover and what the creator wrote."""
    looked = look_up_instagram(url, client)
    size = save_video(looked, workdir, cdn)
    return Fetched(
        meta=looked.meta,
        raw=looked.raw,
        bytes=size,
        credits_spent=looked.credits_spent,
        credits_remaining=looked.credits_remaining,
        calls=looked.calls,
    )


def fetch_youtube(
    url: str,
    workdir: Path,
    client: httpx.Client | None = None,
    cdn: httpx.Client | None = None,
) -> Fetched:
    """A YouTube video by its link. The length is checked first (2 credits) so a long video isn't
    bought (10 credits) only to be refused."""
    opened: list[httpx.Client] = []  # the clients this call made, and so must close
    if client is None:
        client = _client()
        opened.append(client)
    if cdn is None:
        cdn = _cdn()
        opened.append(cdn)
    try:
        info = _get(client, "/v1/youtube/info", {"url": url})
        duration = info.get("duration_seconds")
        if isinstance(duration, int | float) and duration > settings.reel_max_seconds:
            raise SaveApiError("TOO_LONG", f"{duration:.0f}s is over the limit")
        spent_total = float((info.get("credits") or {}).get("spent") or 0)
        created = _get(client, "/v1/youtube/create", {"url": url, "quality": YOUTUBE_QUALITY})
        spent, remaining = _credits(created)
        size = _save_file(
            cdn, created["url"], workdir / "reel.mp4", settings.reel_upload_max_mb * 1024 * 1024
        )
        _save_thumbnail(cdn, created.get("thumbnail") or info.get("thumbnail"), workdir)
        title = str(created.get("title") or info.get("title") or "")
        return Fetched(
            meta={
                "shortcode": info.get("video_id") or "",
                # A YouTube channel is not a WishTrip creator: no one to credit but the importer.
                "owner_username": "",
                "owner_full_name": "",
                "caption": title,
                "hashtags": [],
                "location": "",
                "posted_at": None,
                "duration": created.get("duration_seconds") or duration,
                "source": youtube_source(info, created),
            },
            raw={"info": scrub(info), "create": scrub(created)},
            bytes=size,
            credits_spent=spent_total + float(spent or 0),
            credits_remaining=remaining,
            calls=["/v1/youtube/info", "/v1/youtube/create"],
        )
    finally:
        for c in opened:
            c.close()
