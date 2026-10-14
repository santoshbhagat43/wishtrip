"""Download one Instagram reel with instaloader. Runs as its own process:

    python -m app.modules.reels.fetch <shortcode> <workdir>

instaloader is blocking, sleeps on rate limits and keeps global state, so the worker runs it in
a subprocess it can time out and kill. Writes <workdir>/reel.mp4, thumb.jpg and meta.json; the
exit code says what went wrong (see EXIT_*), and the last stderr line says it in words.
"""

import json
import sys
from pathlib import Path

EXIT_OK = 0
EXIT_NOT_FOUND = 2  # deleted, private, or not a post
EXIT_BLOCKED = 3  # Instagram wants a login, or is rate-limiting this server
EXIT_NOT_VIDEO = 4
EXIT_FAILED = 5


def main(shortcode: str, workdir: str) -> int:
    import instaloader
    from instaloader import exceptions as ix

    from app.core.config import settings

    out = Path(workdir)
    out.mkdir(parents=True, exist_ok=True)
    loader = instaloader.Instaloader(
        quiet=True,
        download_comments=False,
        download_geotags=False,
        save_metadata=False,
        max_connection_attempts=2,
        request_timeout=30,
    )
    if settings.instagram_username and settings.instagram_session_file:
        session_file = Path(settings.instagram_session_file)
        if session_file.exists():
            loader.load_session_from_file(settings.instagram_username, str(session_file))
    try:
        post = instaloader.Post.from_shortcode(loader.context, shortcode)
        if not post.is_video or not post.video_url:
            print("This post has no video.", file=sys.stderr)
            return EXIT_NOT_VIDEO
        loader.download_pic(str(out / "reel"), post.video_url, post.date_utc)
        loader.download_pic(str(out / "thumb"), post.url, post.date_utc)
        meta = {
            "shortcode": post.shortcode,
            "owner_username": post.owner_username,
            "owner_full_name": _safe(lambda: post.owner_profile.full_name),
            "caption": post.caption or "",
            "hashtags": list(post.caption_hashtags),
            "location": _safe(lambda: post.location.name if post.location else ""),
            "posted_at": post.date_utc.isoformat() + "+00:00",
            "duration": post.video_duration,
        }
        (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        return EXIT_OK
    except (ix.QueryReturnedNotFoundException, ix.PrivateProfileNotFollowedException) as exc:
        print(f"Reel not found or private: {exc}", file=sys.stderr)
        return EXIT_NOT_FOUND
    except (
        ix.LoginRequiredException,
        ix.TooManyRequestsException,
        ix.QueryReturnedForbiddenException,
    ) as exc:
        print(f"Instagram blocked the download: {exc}", file=sys.stderr)
        return EXIT_BLOCKED
    except ix.ConnectionException as exc:
        # instaloader reports "login required"/"wait a few minutes" as connection errors too.
        text = str(exc).lower()
        blocked = any(w in text for w in ("login", "401", "403", "429", "wait a few minutes"))
        print(f"Instagram download failed: {exc}", file=sys.stderr)
        return EXIT_BLOCKED if blocked else EXIT_FAILED
    except ix.InstaloaderException as exc:
        print(f"Instagram download failed: {exc}", file=sys.stderr)
        return EXIT_FAILED


def _safe(read):
    """Extra fields cost another request and are often refused without a login: never fail."""
    try:
        return read() or ""
    except Exception:
        return ""


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
