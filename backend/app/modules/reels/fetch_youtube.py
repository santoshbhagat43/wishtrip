"""Download one YouTube video with yt-dlp. Runs as its own process, like the Instagram download:

    python -m app.modules.reels.fetch_youtube <watch url> <workdir>

Writes <workdir>/reel.mp4, thumb.jpg and meta.json (the same files as fetch.py); the exit code
says what went wrong (see fetch.EXIT_*), and the last stderr line says it in words.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

from app.modules.reels.fetch import (
    EXIT_BLOCKED,
    EXIT_FAILED,
    EXIT_NOT_FOUND,
    EXIT_NOT_VIDEO,
    EXIT_OK,
)

EXIT_TOO_LONG = 6

# Up to 480p is plenty to read text off and listen to, and keeps the download small and quick.
FORMAT = "bv*[height<=480]+ba/b[height<=480]/b"

# What yt-dlp says when YouTube refuses the server rather than the video being unavailable.
BLOCKED_WORDS = ("confirm you", "not a bot", "sign in", "429", "403", "too many requests")
GONE_WORDS = ("private", "unavailable", "removed", "deleted", "does not exist", "not available")


def main(url: str, workdir: str) -> int:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    from app.core.config import settings

    out = Path(workdir)
    out.mkdir(parents=True, exist_ok=True)
    options = {
        "format": FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(out / "reel.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 2,
        # YouTube sends video in many small pieces: fetching several at once is much quicker.
        "concurrent_fragment_downloads": 4,
        "writethumbnail": True,
        "postprocessors": [
            {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"}
        ],
    }
    if settings.youtube_proxy:
        options["proxy"] = settings.youtube_proxy
    cookies = settings.youtube_cookies_file
    if cookies and Path(cookies).exists():
        # A signed-in session: the way past "confirm you're not a bot" on a server's address.
        options["cookiefile"] = cookies
    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("is_live") or info.get("live_status") in ("is_upcoming", "is_live"):
                print("This is a live stream, not a video.", file=sys.stderr)
                return EXIT_NOT_VIDEO
            duration = float(info.get("duration") or 0)
            if duration > settings.reel_max_seconds:
                print(f"{duration:.0f}s is over the limit.", file=sys.stderr)
                return EXIT_TOO_LONG
            ydl.process_ie_result(info, download=True)
    except DownloadError as exc:
        text = str(exc).lower()
        print(f"YouTube download failed: {exc}", file=sys.stderr)
        if any(w in text for w in BLOCKED_WORDS):
            return EXIT_BLOCKED
        return EXIT_NOT_FOUND if any(w in text for w in GONE_WORDS) else EXIT_FAILED

    thumb = next(iter(sorted(out.glob("reel.jpg"))), None)
    if thumb is not None:
        thumb.rename(out / "thumb.jpg")
    uploaded = str(info.get("upload_date") or "")
    description = str(info.get("description") or "")[:2000]
    meta = {
        "shortcode": info.get("id", ""),
        # A YouTube channel is not a WishTrip creator: no one to credit but the importer.
        "owner_username": "",
        "owner_full_name": "",
        "caption": f"{info.get('title') or ''}\n{description}".strip(),
        "hashtags": [t.replace(" ", "") for t in (info.get("tags") or [])[:15]],
        "location": "",
        "posted_at": (
            datetime.strptime(uploaded, "%Y%m%d").isoformat() + "+00:00"
            if len(uploaded) == 8
            else None
        ),
        "duration": info.get("duration"),
        "source": {
            k: v
            for k, v in {
                "platform": "youtube",
                "source": "yt-dlp",
                "source_url": info.get("webpage_url"),
                "video_id": info.get("id"),
                "title": info.get("title"),
                "author": info.get("channel") or info.get("uploader"),
                "author_url": info.get("channel_url") or info.get("uploader_url"),
                "duration": info.get("duration"),
                "views": info.get("view_count"),
                "likes": info.get("like_count"),
                "comments": info.get("comment_count"),
                "published_at": (
                    datetime.strptime(uploaded, "%Y%m%d").isoformat() + "+00:00"
                    if len(uploaded) == 8
                    else None
                ),
                "categories": info.get("categories"),
                "tags": (info.get("tags") or [])[:15],
            }.items()
            if v not in (None, "", [])
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
