"""SaveAPI as the fallback when our own download of a reel or video fails, and the record kept of
every download attempt."""

import subprocess

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.reels import fetch, fetch_youtube, saveapi
from app.modules.reels import service as reels
from app.modules.reels.models import DownloadRequest
from tests.conftest import auth

VIDEO_BYTES = b"\x00\x00\x00\x18ftypmp42" + b"v" * 2000
IG = "https://www.instagram.com/reel/Cabc123xyz/"
YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setattr(settings, "saveapi_key", "sk_live_test")
    # These tests drive download() and the client; the caption-first route is tested in test_reels.
    monkeypatch.setattr(settings, "reel_caption_first", False)
    monkeypatch.setattr(saveapi.time, "sleep", lambda *_: None)


def api_client(routes: dict[str, httpx.Response | list[httpx.Response]], seen: list | None = None):
    """A SaveAPI client whose answers are canned, per path (a list is answered in turn)."""

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        answer = routes[request.url.path]
        if isinstance(answer, list):
            return answer.pop(0)
        return answer

    return httpx.Client(
        base_url="https://api.saveapi.org",
        headers={"Authorization": "Bearer sk_live_test"},
        transport=httpx.MockTransport(handler),
    )


def cdn_client(seen: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.path.endswith(".jpg"):
            return httpx.Response(200, content=b"jpegbytes")
        return httpx.Response(200, content=VIDEO_BYTES)

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def ok(body: dict) -> httpx.Response:
    return httpx.Response(200, json={"success": True, **body})


def refused(code: str, status: int, message: str = "no", headers: dict | None = None):
    return httpx.Response(
        status,
        json={"success": False, "error": {"code": code, "message": message}},
        headers=headers,
    )


INSTAGRAM_REEL = {
    "platform": "instagram",
    "video_id": "Cabc123xyz",
    "medias": [
        {"type": "image", "url": "https://cdn.example/cover.jpg"},
        {"type": "video", "url": "https://cdn.example/reel.mp4", "ext": "mp4"},
    ],
    "meta": {
        "text": "Slow days in Goa #goa #beach",
        "username": "goadiaries",
        "author": "Goa Diaries",
        "location": "Anjuna",
        "region": "Goa",
        "published_at": 1760000000,
        "duration": 21,
        "likes": 205212,
        "comments": 995,
        "views": None,
        "author_url": "https://www.instagram.com/goadiaries/",
        "author_verified": True,
        "author_avatar": "https://cdn.example/avatar.jpg",
        "thumbnail": "https://cdn.example/thumb.jpg",
        "music": {"title": "Run It Up", "author": "Hanumankind", "original": False},
    },
    "credits": {"spent": 1.5, "remaining": 998.5},
}


# The client ----------------------------------------------------------------------------------


def test_an_instagram_reel_is_fetched_with_what_the_creator_wrote(tmp_path):
    api_seen, cdn_seen = [], []
    fetched = saveapi.fetch_instagram(
        IG,
        tmp_path,
        api_client({"/v1/download": ok(INSTAGRAM_REEL)}, api_seen),
        cdn_client(cdn_seen),
    )
    assert (tmp_path / "reel.mp4").read_bytes() == VIDEO_BYTES
    assert (tmp_path / "thumb.jpg").read_bytes() == b"jpegbytes"
    assert fetched.meta["owner_username"] == "goadiaries"
    assert fetched.meta["caption"] == "Slow days in Goa #goa #beach"
    assert fetched.meta["hashtags"] == ["goa", "beach"]
    assert fetched.meta["location"] == "Anjuna, Goa"
    assert fetched.meta["posted_at"].startswith("2025-10-")
    source = fetched.meta["source"]
    assert (source["author"], source["likes"], source["comments"]) == ("Goa Diaries", 205212, 995)
    assert source["music"] == {"title": "Run It Up", "author": "Hanumankind", "original": False}
    assert source["author_verified"] is True and source["video_id"] == "Cabc123xyz"
    # The log keeps SaveAPI's answer whole, minus the (signed, expiring) file links.
    assert fetched.raw["meta"]["author"] == "Goa Diaries"
    assert fetched.raw["video_id"] == "Cabc123xyz"
    assert all("url" not in m for m in fetched.raw["medias"]) and "success" not in fetched.raw
    assert "views" not in source  # what SaveAPI didn't know is left out, not shown as zero
    # The links that expire are not kept.
    assert not any("cdn.example" in str(v) for v in source.values())
    assert (fetched.credits_spent, fetched.credits_remaining) == (1.5, 998.5)
    assert fetched.bytes == len(VIDEO_BYTES)
    assert api_seen[0].url.params["url"] == IG
    # The key goes to SaveAPI only: never to the CDN the file is fetched from.
    assert all("authorization" not in r.headers for r in cdn_seen)


def test_a_post_with_no_video_is_refused(tmp_path):
    body = {**INSTAGRAM_REEL, "medias": [{"type": "image", "url": "https://cdn.example/x.jpg"}]}
    with pytest.raises(saveapi.SaveApiError) as err:
        saveapi.fetch_instagram(IG, tmp_path, api_client({"/v1/download": ok(body)}), cdn_client())
    assert err.value.code == "MEDIA_NOT_FOUND"


def test_a_youtube_video_is_checked_for_length_before_it_is_bought(tmp_path):
    seen = []
    long = ok(
        {
            "video_id": "dQw4w9WgXcQ",
            "title": "Long",
            "duration_seconds": 900,
            "credits": {"spent": 2},
        }
    )
    with pytest.raises(saveapi.SaveApiError) as err:
        saveapi.fetch_youtube(
            YT, tmp_path, api_client({"/v1/youtube/info": long}, seen), cdn_client()
        )
    assert err.value.code == "TOO_LONG"
    assert [r.url.path for r in seen] == ["/v1/youtube/info"]  # the 10-credit call never happened


def test_a_youtube_video_is_fetched_in_480p(tmp_path):
    seen = []
    routes = {
        "/v1/youtube/info": ok(
            {
                "video_id": "dQw4w9WgXcQ",
                "title": "Bali",
                "duration_seconds": 120,
                "credits": {"spent": 2},
            }
        ),
        "/v1/youtube/create": ok(
            {
                "url": "https://cdn.example/video.mp4",
                "title": "Bali in 3 days",
                "duration_seconds": 120,
                "thumbnail": "https://cdn.example/t.jpg",
                "credits": {"spent": 10, "remaining": 88},
            }
        ),
    }
    fetched = saveapi.fetch_youtube(YT, tmp_path, api_client(routes, seen), cdn_client())
    assert [r.url.path for r in seen] == ["/v1/youtube/info", "/v1/youtube/create"]
    assert seen[1].url.params["quality"] == "480p"
    assert fetched.meta["caption"] == "Bali in 3 days"
    assert fetched.meta["owner_username"] == ""  # a channel isn't a WishTrip creator
    assert fetched.meta["source"]["title"] == "Bali in 3 days"
    assert fetched.meta["source"]["duration_seconds"] == 120
    assert not any("cdn.example" in str(v) for v in fetched.meta["source"].values())
    assert "credits" not in fetched.meta["source"]
    assert (fetched.credits_spent, fetched.credits_remaining) == (12.0, 88)
    assert (tmp_path / "reel.mp4").exists()


def test_failures_a_retry_can_fix_are_retried_once_and_others_are_not(tmp_path):
    calls = []
    flaky = {
        "/v1/download": [refused("UPSTREAM_TIMEOUT", 504), ok(INSTAGRAM_REEL)],
    }
    saveapi.fetch_instagram(IG, tmp_path, api_client(flaky, calls), cdn_client())
    assert flaky["/v1/download"] == []  # both answers were used

    private = {"/v1/download": [refused("PRIVATE_CONTENT", 403), ok(INSTAGRAM_REEL)]}
    with pytest.raises(saveapi.SaveApiError) as err:
        saveapi.fetch_instagram(IG, tmp_path, api_client(private), cdn_client())
    assert err.value.code == "PRIVATE_CONTENT" and len(private["/v1/download"]) == 1  # not retried


def test_a_long_rate_limit_wait_is_not_held_for(tmp_path):
    limited = {"/v1/download": refused("RATE_LIMITED", 429, headers={"Retry-After": "120"})}
    with pytest.raises(saveapi.SaveApiError) as err:
        saveapi.fetch_instagram(IG, tmp_path, api_client(limited), cdn_client())
    assert err.value.code == "RATE_LIMITED"


def test_an_oversized_file_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "reel_upload_max_mb", 0)
    with pytest.raises(saveapi.SaveApiError) as err:
        saveapi.fetch_instagram(
            IG, tmp_path, api_client({"/v1/download": ok(INSTAGRAM_REEL)}), cdn_client()
        )
    assert err.value.code == "FILE_TOO_LARGE"


# The fallback ---------------------------------------------------------------------------------


def our_download_exits(monkeypatch, code: int, tmp_path):
    # These tests are about our own download with SaveAPI as its fallback: Instagram reels only go
    # that way when INSTAGRAM_VIA_SAVEAPI is off (YouTube always does).
    monkeypatch.setattr(settings, "instagram_via_saveapi", False)

    def run(cmd, **kw):
        if code == fetch.EXIT_OK:
            (tmp_path / "meta.json").write_text('{"caption": "ours"}')
        return subprocess.CompletedProcess(cmd, code, "", "boom")

    monkeypatch.setattr(reels.subprocess, "run", run)


def saveapi_gives(monkeypatch, meta=None, error=None):
    calls = []

    def fetch_it(url, workdir, **kw):
        calls.append(url)
        if error:
            raise error
        return saveapi.Fetched(
            meta=meta or {"caption": "theirs"}, bytes=10, credits_spent=1.5, credits_remaining=9
        )

    monkeypatch.setattr(saveapi, "fetch_instagram", fetch_it)
    monkeypatch.setattr(saveapi, "fetch_youtube", fetch_it)
    return calls


@pytest.mark.parametrize("code", [fetch.EXIT_BLOCKED, fetch.EXIT_FAILED])
def test_instagram_blocking_us_falls_back_to_saveapi(monkeypatch, tmp_path, code):
    our_download_exits(monkeypatch, code, tmp_path)
    calls = saveapi_gives(monkeypatch)
    attempts: list[reels.Attempt] = []
    assert reels.download("Cabc123xyz", tmp_path, attempts) == {"caption": "theirs"}
    assert calls == [IG]
    assert [(a.provider, a.ok) for a in attempts] == [("instaloader", False), ("saveapi", True)]
    assert attempts[1].credits_spent == 1.5 and attempts[1].bytes == 10


def test_a_timeout_also_falls_back(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "instagram_via_saveapi", False)

    def slow(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 1)

    monkeypatch.setattr(reels.subprocess, "run", slow)
    calls = saveapi_gives(monkeypatch)
    attempts: list[reels.Attempt] = []
    reels.download("Cabc123xyz", tmp_path, attempts)
    assert calls and attempts[0].error_code == "TIMEOUT"


def test_youtube_blocking_the_server_falls_back_to_saveapi(monkeypatch, tmp_path):
    our_download_exits(monkeypatch, fetch.EXIT_BLOCKED, tmp_path)
    calls = saveapi_gives(monkeypatch)
    attempts: list[reels.Attempt] = []
    assert reels.download("yt-dQw4w9WgXcQ", tmp_path, attempts) == {"caption": "theirs"}
    assert calls == [YT]
    assert [a.provider for a in attempts] == ["yt-dlp", "saveapi"]


def test_our_own_download_working_never_costs_credits(monkeypatch, tmp_path):
    our_download_exits(monkeypatch, fetch.EXIT_OK, tmp_path)
    calls = saveapi_gives(monkeypatch)
    attempts: list[reels.Attempt] = []
    assert reels.download("Cabc123xyz", tmp_path, attempts) == {"caption": "ours"}
    assert calls == [] and [(a.provider, a.ok) for a in attempts] == [("instaloader", True)]


@pytest.mark.parametrize(
    "code", [fetch.EXIT_NOT_FOUND, fetch.EXIT_NOT_VIDEO, fetch_youtube.EXIT_TOO_LONG]
)
def test_failures_saveapi_could_not_fix_are_not_sent_to_it(monkeypatch, tmp_path, code):
    our_download_exits(monkeypatch, code, tmp_path)
    calls = saveapi_gives(monkeypatch)
    with pytest.raises(reels.ReelError):
        reels.download("Cabc123xyz", tmp_path)
    assert calls == []


def test_without_a_key_there_is_no_fallback(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "saveapi_key", None)
    our_download_exits(monkeypatch, fetch.EXIT_BLOCKED, tmp_path)
    calls = saveapi_gives(monkeypatch)
    with pytest.raises(reels.ReelError, match="Instagram is not letting us"):
        reels.download("Cabc123xyz", tmp_path)
    assert calls == []


def test_saveapi_saying_private_tells_the_creator_so(monkeypatch, tmp_path):
    our_download_exits(monkeypatch, fetch.EXIT_BLOCKED, tmp_path)
    saveapi_gives(monkeypatch, error=saveapi.SaveApiError("PRIVATE_CONTENT", "private"))
    attempts: list[reels.Attempt] = []
    with pytest.raises(reels.ReelError, match="private or deleted"):
        reels.download("Cabc123xyz", tmp_path, attempts)
    assert attempts[1].error_code == "PRIVATE_CONTENT" and not attempts[1].ok


def test_a_problem_with_our_saveapi_account_shows_the_original_failure(
    monkeypatch, tmp_path, caplog
):
    our_download_exits(monkeypatch, fetch.EXIT_BLOCKED, tmp_path)
    saveapi_gives(monkeypatch, error=saveapi.SaveApiError("QUOTA_EXCEEDED", "no credits"))
    with pytest.raises(reels.ReelError, match="Instagram is not letting us"):
        reels.download("Cabc123xyz", tmp_path)
    # …and says loudly, in the logs, that it's the account that needs attention.
    assert "QUOTA_EXCEEDED" in caplog.text


def test_a_youtube_video_too_long_for_saveapi_says_so(monkeypatch, tmp_path):
    our_download_exits(monkeypatch, fetch.EXIT_BLOCKED, tmp_path)
    saveapi_gives(monkeypatch, error=saveapi.SaveApiError("TOO_LONG", "900s"))
    with pytest.raises(reels.ReelError, match="longer than 3 minutes"):
        reels.download("yt-dQw4w9WgXcQ", tmp_path)


# Instagram from SaveAPI only ------------------------------------------------------------------


def our_download_must_not_run(monkeypatch):
    def run(cmd, **kw):
        raise AssertionError("instaloader must not run for Instagram")

    monkeypatch.setattr(reels.subprocess, "run", run)


def test_an_instagram_reel_comes_from_saveapi_without_trying_our_own_download(
    monkeypatch, tmp_path
):
    our_download_must_not_run(monkeypatch)
    calls = saveapi_gives(monkeypatch)
    attempts: list[reels.Attempt] = []
    assert reels.download("Cabc123xyz", tmp_path, attempts) == {"caption": "theirs"}
    assert calls == [IG]
    assert [(a.provider, a.ok) for a in attempts] == [("saveapi", True)]
    assert attempts[0].credits_spent == 1.5


def test_youtube_still_tries_our_own_download_first(monkeypatch, tmp_path):
    def run(cmd, **kw):
        (tmp_path / "meta.json").write_text('{"caption": "ours"}')
        return subprocess.CompletedProcess(cmd, fetch.EXIT_OK, "", "")

    monkeypatch.setattr(reels.subprocess, "run", run)
    calls = saveapi_gives(monkeypatch)
    assert reels.download("yt-dQw4w9WgXcQ", tmp_path) == {"caption": "ours"}
    assert calls == []


@pytest.mark.parametrize(
    ("code", "says"),
    [
        ("PRIVATE_CONTENT", "private or deleted"),
        ("MEDIA_NOT_FOUND", "private or deleted"),
        ("FILE_TOO_LARGE", "over 120 MB"),
        ("QUOTA_EXCEEDED", "couldn't download that reel"),
        ("UPSTREAM_TIMEOUT", "couldn't download that reel"),
    ],
)
def test_saveapi_failing_on_instagram_says_what_happened(monkeypatch, tmp_path, code, says):
    our_download_must_not_run(monkeypatch)
    saveapi_gives(monkeypatch, error=saveapi.SaveApiError(code, "nope"))
    attempts: list[reels.Attempt] = []
    with pytest.raises(reels.ReelError, match=says):
        reels.download("Cabc123xyz", tmp_path, attempts)
    assert [(a.provider, a.ok, a.error_code) for a in attempts] == [("saveapi", False, code)]


def test_without_a_key_instagram_uses_our_own_download(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "saveapi_key", None)

    def run(cmd, **kw):
        (tmp_path / "meta.json").write_text('{"caption": "ours"}')
        return subprocess.CompletedProcess(cmd, fetch.EXIT_OK, "", "")

    monkeypatch.setattr(reels.subprocess, "run", run)
    calls = saveapi_gives(monkeypatch)
    assert reels.download("Cabc123xyz", tmp_path) == {"caption": "ours"}
    assert calls == []


# The record ----------------------------------------------------------------------------------


async def test_every_attempt_is_recorded_even_when_the_import_fails(monkeypatch):
    def download(shortcode, workdir):
        attempts = reels._attempts.get()
        attempts.append(
            reels.Attempt("instaloader", "instagram", IG, shortcode, error_code="EXIT_3")
        )
        attempts.append(
            reels.Attempt(
                "saveapi", "instagram", IG, shortcode, error_code="MEDIA_NOT_FOUND", duration_ms=420
            )
        )
        raise reels.ReelError("We couldn't open that reel. It may be private or deleted.")

    monkeypatch.setattr(reels, "download", download)
    async with SessionLocal() as session:
        with pytest.raises(reels.ReelError):
            await reels.produce_content(session, None, "Cfail00001")  # type: ignore[arg-type]
    async with SessionLocal() as session:
        rows = list(
            await session.scalars(select(DownloadRequest).order_by(DownloadRequest.provider))
        )
    assert [(r.provider, r.ok, r.error_code, r.shortcode) for r in rows] == [
        ("instaloader", False, "EXIT_3", "Cfail00001"),
        ("saveapi", False, "MEDIA_NOT_FOUND", "Cfail00001"),
    ]
    assert rows[1].duration_ms == 420


async def test_staff_can_read_the_log_and_the_totals(client, admin, traveler):
    async with SessionLocal() as session:
        session.add_all(
            [
                DownloadRequest(
                    provider="instaloader",
                    platform="instagram",
                    source_url=IG,
                    shortcode="a",
                    ok=False,
                    error_code="EXIT_3",
                ),
                DownloadRequest(
                    provider="saveapi",
                    platform="instagram",
                    source_url=IG,
                    shortcode="a",
                    ok=True,
                    credits_spent=1.5,
                    credits_remaining=98.5,
                    bytes=1234,
                    duration_ms=900,
                ),
                DownloadRequest(
                    provider="saveapi",
                    platform="youtube",
                    source_url=YT,
                    shortcode="yt-b",
                    ok=True,
                    credits_spent=12,
                    credits_remaining=86.5,
                ),
            ]
        )
        await session.commit()

    r = await client.get("/reels/downloads", headers=auth(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    totals = {t["provider"]: t for t in body["totals"]}
    assert totals["saveapi"]["attempts"] == 2 and totals["saveapi"]["credits_spent"] == 13.5
    assert totals["instaloader"]["failures"] == 1 and totals["instaloader"]["credits_spent"] == 0
    assert body["credits_remaining"] in (86.5, 98.5)
    assert len(body["requests"]) == 3

    assert (await client.get("/reels/downloads", headers=auth(traveler))).status_code == 403
    assert (await client.get("/reels/downloads")).status_code == 401


async def test_attempts_are_kept_on_the_engine_they_are_given():
    # In a worker every job runs in a new event loop with its own engine: the attempts must be
    # written on that engine, not the app's shared pool (whose connections belong to a closed loop).
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    from app.core.config import settings as app_settings

    engine = create_async_engine(app_settings.database_url, poolclass=NullPool)
    try:
        await reels.record_attempts(
            [reels.Attempt("saveapi", "instagram", IG, "Cengine01", ok=True, meta={"x": 1})], engine
        )
    finally:
        await engine.dispose()
    async with SessionLocal() as session:
        row = await session.scalar(
            select(DownloadRequest).where(DownloadRequest.shortcode == "Cengine01")
        )
    assert row is not None and row.ok and row.meta == {"x": 1}
