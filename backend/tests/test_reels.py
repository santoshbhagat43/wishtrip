import json
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.modules.creators.models import CommissionEntry, Creator
from app.modules.reels import media, service
from app.modules.reels.understand import clean_reading
from app.modules.users.models import User
from tests.conftest import auth, sign_up

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("tesseract")), reason="needs ffmpeg + tesseract"
)

REEL = "https://www.instagram.com/reel/DAbc123xyz/?igsh=xyz"


def make_reel(path: Path, lines: list[str]) -> Path:
    """A real little reel: one slide per text line, with a tone as its soundtrack."""
    from PIL import Image, ImageDraw, ImageFont

    path.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=64)
    for i, line in enumerate(lines):
        img = Image.new("RGB", (720, 1280), (30, 60, 90))
        ImageDraw.Draw(img).text((60, 600), line, fill="white", font=font)
        img.save(path / f"s{i}.png")
    video = path / "reel.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "1", "-i", str(path / "s%d.png"),
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={len(lines)}",
         "-r", "30", "-pix_fmt", "yuv420p", "-shortest", str(video)],
        check=True,
    )  # fmt: skip
    (path / "thumb.jpg").write_bytes((path / "s0.png").read_bytes())
    return video


class ReelAI:
    """Stands in for OpenRouter: Gemini 'hears' the voice-over, the planner reads places."""

    enabled = True
    provider = "openrouter"
    MODELS = {"intent": "i", "planner": "p", "transcribe": "google/gemini-2.5-flash"}

    def __init__(self):
        self.calls = []

    def model_for(self, task):
        return self.MODELS[task]

    def supports(self, task):
        return task in self.MODELS

    async def chat(self, task, messages, **kwargs):
        self.calls.append((task, messages))
        if task == "transcribe":
            return json.dumps(
                {
                    "language": "en",
                    "transcript": "Start your morning at Borough Market, the food is unreal.",
                    "english": "Start your morning at Borough Market, the food is unreal.",
                    "music_only": False,
                }
            )
        if task == "planner" and "You read travel reels" in messages[0]["content"]:
            return json.dumps(
                {
                    "destination": "London",
                    "country": "United Kingdom",
                    "summary": "A food and views day in London.",
                    "days_hint": 2,
                    "places": [
                        {"name": "Tower Bridge", "kind": "sight", "evidence": "Tower Bridge",
                         "source": "screen", "t": 0},
                        {"name": "Borough Market Food Walk", "kind": "food",
                         "evidence": "Borough Market", "source": "voice", "t": 2},
                        {"name": "Dishoom Shoreditch", "kind": "food",
                         "evidence": "breakfast at Dishoom", "source": "caption", "t": None},
                        # Not in the reel at all: must be dropped.
                        {"name": "Big Ben", "kind": "sight", "evidence": "", "source": "voice"},
                    ],
                    "tips": ["Go to the market before 10 am."],
                }
            )  # fmt: skip
        return json.dumps({"intent": "plan_trip", "destination": "London"})


def test_shortcodes():
    assert service.shortcode_from(REEL) == "DAbc123xyz"
    assert service.shortcode_from("instagram.com/p/C9xYz_-12/") == "C9xYz_-12"
    assert service.shortcode_from("https://www.instagram.com/goadiaries/reel/DAbc123xyz") == (
        "DAbc123xyz"
    )
    assert (
        service.shortcode_from("https://youtube.com/shorts/abc") is None
    )  # not an 11-character id
    for link in (
        "https://www.youtube.com/shorts/GE4EgoAVqPA",
        "youtube.com/watch?v=GE4EgoAVqPA&t=9s",
        "https://youtu.be/GE4EgoAVqPA?si=x",
        "https://m.youtube.com/live/GE4EgoAVqPA",
    ):
        assert service.shortcode_from(link) == "yt-GE4EgoAVqPA", link
    assert service.canonical_url("yt-GE4EgoAVqPA") == "https://www.youtube.com/watch?v=GE4EgoAVqPA"


def test_ocr_noise_is_dropped():
    assert media.clean_line("  Fort Aguada  ") == "Fort Aguada"
    assert media.clean_line("|| ~~ ||") is None
    assert media.clean_line("@#1 2 3") is None
    assert media.clean_line("4.5 ★ 120") is None


def test_places_need_evidence_in_the_reel():
    reading = clean_reading(
        {
            "destination": "Goa",
            "places": [
                {"name": "Fort Aguada", "kind": "sight", "evidence": "sunset at fort aguada"},
                {"name": "Baga Beach", "kind": "beach!", "evidence": "the best beach"},
                {"name": "Fort Aguada", "kind": "sight", "evidence": "again"},
            ],
            "days_hint": 99,
        },
        "CAPTION: Sunset at Fort Aguada 🌅",
    )
    assert [p["name"] for p in reading.places] == ["Fort Aguada"]
    assert reading.days_hint is None


@needs_ffmpeg
def test_frames_and_ocr_read_the_screen(tmp_path):
    video = make_reel(tmp_path, ["Tower Bridge", "Borough Market"])
    info = media.probe(video)
    assert info.has_audio and 1.5 < info.duration < 3
    lines = media.ocr(media.frames(video, tmp_path / "frames", 20))
    text = " ".join(line["text"] for line in lines).lower()
    assert "tower bridge" in text and "borough market" in text
    assert len(lines) == len({line["text"] for line in lines})  # each line once


@pytest.fixture
def fake_instagram(tmp_path, monkeypatch):
    """instaloader stand-in: 'downloads' a locally made reel into the work dir."""
    if not (shutil.which("ffmpeg") and shutil.which("tesseract")):
        pytest.skip("needs ffmpeg + tesseract")
    source = tmp_path / "source"
    make_reel(source, ["Tower Bridge", "Borough Market"])
    downloads = []

    def download(shortcode, workdir):
        downloads.append(shortcode)
        shutil.copy(source / "reel.mp4", workdir / "reel.mp4")
        shutil.copy(source / "thumb.jpg", workdir / "thumb.jpg")
        return {
            "shortcode": shortcode,
            "owner_username": "londonbites",
            "owner_full_name": "London Bites",
            "caption": "Weekend in London: breakfast at Dishoom, then the river #london",
            "hashtags": ["london"],
            "location": "London, United Kingdom",
            "posted_at": "2026-09-01T10:00:00+00:00",
            "duration": 2.0,
        }

    monkeypatch.setattr(service, "download", download)
    monkeypatch.setattr(settings, "reels_inline", True)
    return downloads


async def test_reel_becomes_places_a_chat_and_a_creator(
    client, traveler, admin, london, fake_instagram
):
    ai = ReelAI()
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=ai)
    try:
        r = await client.post("/reels/imports", json={"url": REEL}, headers=auth(traveler))
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["status"] == "done", job["error"]
    content = job["content"]
    assert content["creator_handle"] == "londonbites"
    assert content["destination_name"] == "London"
    assert content["has_voice"] and content["screen_lines"] >= 2
    places = {p["name"]: p for p in content["places"]}
    assert set(places) == {"Tower Bridge", "Borough Market Food Walk", "Dishoom Shoreditch"}
    assert places["Tower Bridge"]["verified"] and places["Tower Bridge"]["location_id"]
    assert places["Borough Market Food Walk"]["verified"]
    assert not places["Dishoom Shoreditch"]["verified"]  # in the reel, not in our KB
    assert "Tower Bridge" in job["seed_message"]

    # Staff can see the stage timings, the log and the text that was read.
    as_staff = auth(admin)
    listing = (await client.get("/reels/admin/imports", headers=as_staff)).json()
    row = next(i for i in listing["items"] if i["id"] == job["id"])
    assert row["status"] == "done" and row["requested_by"] == traveler.email
    assert [s["step"] for s in row["stages"]] == [
        "downloading", "reading_screen", "finding_places"
    ]  # fmt: skip
    assert listing["totals"]["done"] >= 1 and row["total_seconds"] is not None
    detail = (await client.get(f"/reels/admin/imports/{job['id']}", headers=as_staff)).json()
    assert any("Screen:" in e["message"] for e in detail["log"])
    assert any("Voice-over:" in e["message"] for e in detail["log"])
    assert detail["transcript"] and len(detail["ocr_lines"]) >= 2
    assert (await client.get("/reels/admin/imports", headers=auth(traveler))).status_code == 403

    # The model saw caption, screen text and voice-over together.
    reading = next(m for task, m in ai.calls if task == "planner")[1]["content"]
    assert "Dishoom" in reading and "Tower Bridge" in reading and "Borough Market" in reading

    # The traveller's chat session carries the reel for the planner.
    chat = (
        await client.get(f"/chat/sessions/{job['chat_session_id']}", headers=auth(traveler))
    ).json()
    assert chat["state"]["destination"] == "London"
    assert chat["state"]["reel"]["handle"] == "londonbites"

    # The creator is saved (unclaimed) and credited with this new traveller.
    async with SessionLocal() as session:
        creator = await session.scalar(select(Creator).where(Creator.handle == "londonbites"))
        user = await session.get(User, traveler.id)
    assert creator.status == "unclaimed" and creator.referral_code == "londonbites"
    assert user.referred_by_creator_id == creator.id

    # A second paste of the same reel reuses what we read: no new download.
    again = await client.post("/reels/imports", json={"url": REEL}, headers=auth(traveler))
    assert again.json()["status"] == "done"
    assert fake_instagram == ["DAbc123xyz"]


async def test_failed_download_is_explained(client, traveler, monkeypatch):
    def blocked(shortcode, workdir):
        raise service.ReelError("Instagram is not letting us read reels right now.")

    monkeypatch.setattr(service, "download", blocked)
    monkeypatch.setattr(settings, "reels_inline", True)
    r = await client.post("/reels/imports", json={"url": REEL}, headers=auth(traveler))
    job = r.json()
    assert job["status"] == "failed"
    assert "Instagram" in job["error"]
    bad = await client.post("/reels/imports", json={"url": "hello"}, headers=auth(traveler))
    assert bad.status_code == 400 and "Instagram reel or YouTube" in bad.json()["detail"]


async def test_a_pasted_youtube_link_is_imported_like_a_reel(client, traveler, monkeypatch):
    seen = []

    def fake_download(shortcode, workdir):
        seen.append(shortcode)
        raise service.ReelError("stop here")

    monkeypatch.setattr(service, "download", fake_download)
    monkeypatch.setattr(settings, "reels_inline", True)
    r = await client.post(
        "/reels/imports",
        json={"url": "https://www.youtube.com/shorts/GE4EgoAVqPA"},
        headers=auth(traveler),
    )
    assert r.status_code == 201, r.text
    assert seen == ["yt-GE4EgoAVqPA"]  # sent down the YouTube path, not refused
    assert r.json()["url"] == "https://www.youtube.com/watch?v=GE4EgoAVqPA"


async def test_referral_signup_then_first_plan_earns_commission(client, admin, london):
    async with SessionLocal() as session:
        session.add(Creator(handle="goadiaries", referral_code="goadiaries",
                            commission_per_user_paise=5000))  # fmt: skip
        await session.commit()
    visit = await client.post("/referrals/GoaDiaries/visit", json={"visitor_id": "v1"})
    assert visit.status_code == 200 and visit.json()["handle"] == "goadiaries"

    r = await sign_up(client, "new@example.com", referral_code="goadiaries", visitor_id="v1")
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    chat = (await client.post("/chat/sessions", headers=headers)).json()
    for _ in range(2):  # the commission is booked once, on the first plan
        turn = await client.post(
            f"/chat/sessions/{chat['id']}/messages",
            json={"content": "Plan 2 days in London with street food"},
            headers=headers,
        )
        assert turn.status_code == 200

    async with SessionLocal() as session:
        entries = list(await session.scalars(select(CommissionEntry)))
    assert len(entries) == 1 and entries[0].amount_paise == 5000

    creators = (await client.get("/creators", headers=auth(admin))).json()["items"]
    stats = creators[0]["stats"]
    assert stats["link_visits"] == 1
    assert stats["credited_travellers"] == 1
    assert stats["trips_planned"] == 1
    assert stats["earned_paise"] == 5000

    detail = (await client.get(f"/creators/{creators[0]['id']}", headers=auth(admin))).json()
    assert [a["event"] for a in detail["activity"]].count("signup") == 1
    r = await client.patch(
        f"/creators/{creators[0]['id']}", json={"status": "active"}, headers=auth(admin)
    )
    assert r.json()["status"] == "active"


async def test_creators_are_staff_only(client, traveler):
    assert (await client.get("/creators", headers=auth(traveler))).status_code == 403


def test_a_close_vector_needs_a_shared_name():
    assert service._shares_name("Thalaser", "Thalassa, Siolim")  # a transcription slip
    assert service._shares_name("Fort Aguada", "Fort Aguada & lighthouse")
    assert not service._shares_name("Cafe Bodega", "Cafe Bhonsle")
    assert not service._shares_name("Baga beach", "Morjim beach")


@needs_ffmpeg
async def test_upload_a_video_builds_a_trip(client, traveler, london, tmp_path, monkeypatch):
    """A traveller uploads a video from their device → same pipeline, no Instagram."""
    monkeypatch.setattr(settings, "reels_inline", True)
    video = make_reel(tmp_path, ["Tower Bridge", "Borough Market"])
    ai = ReelAI()
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=ai)
    try:
        r = await client.post(
            "/reels/uploads",
            content=video.read_bytes(),
            headers={
                **auth(traveler),
                "content-type": "video/mp4",
                "x-reel-filename": "my-reel.mp4",
            },
        )
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["status"] == "done", job["error"]
    content = job["content"]
    # No Instagram owner on an upload.
    assert content["creator_handle"] == ""
    assert content["screen_lines"] >= 2
    assert {"Tower Bridge", "Borough Market Food Walk"} <= {p["name"] for p in content["places"]}
    assert job["chat_session_id"]


async def test_upload_rejects_non_video(client, traveler, monkeypatch):
    monkeypatch.setattr(settings, "reels_inline", True)
    r = await client.post(
        "/reels/uploads",
        content=b"hello",
        headers={**auth(traveler), "content-type": "text/plain"},
    )
    assert r.status_code == 400


# Timestamps ----------------------------------------------------------------------------------


def test_a_time_is_only_ever_one_the_text_on_screen_really_had():
    from app.modules.reels.understand import seen_on_screen

    screen = [
        {"t": 0.0, "text": "BALI IN 4 DAYS"},
        {"t": 4.0, "text": "ijwatu Temple at suns"},  # OCR garbled the first letters
        {"t": 5.0, "text": "jwatu Temple at sun"},  # OCR clipped the first letters
        {"t": 15.0, "text": "2galalang Rice Terra"},
    ]
    assert seen_on_screen("Uluwatu Temple", screen) == 4.0
    assert seen_on_screen("Tegalalang Rice Terrace", screen) == 15.0
    # Only said out loud, never on screen: no time, rather than a made-up one.
    assert seen_on_screen("Kelingking Beach", screen) is None
    # A few letters in common with an unrelated word is not a match ("Guling" / "Kelingking").
    both = [
        {"t": 10.0, "text": "ung Babi Guling Ibu"},
        {"t": 20.0, "text": "Kelingking Beach"},
    ]
    assert seen_on_screen("Kelingking Beach", both) == 20.0
    assert seen_on_screen("Kelingking Beach", both[:1]) is None
    # A word that only says what kind of place it is ("temple") is not a match.
    assert seen_on_screen("Besakih Temple", screen) is None


def test_the_models_own_timestamp_is_ignored():
    reading = clean_reading(
        {
            "places": [
                {"name": "Kelingking Beach", "kind": "sight", "evidence": "Kelingking Beach",
                 "source": "voice", "t": 12.5},
            ]
        },
        "VOICE-OVER:\nSee Kelingking Beach",
        [{"t": 3.0, "text": "Nothing about it here"}],
    )  # fmt: skip
    assert reading.places[0]["t"] is None


# Downloading ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("shortcode", "module", "target", "site"),
    [
        ("Cabc123xyz", "app.modules.reels.fetch", "Cabc123xyz", "Instagram"),
        (
            "yt-dQw4w9WgXcQ",
            "app.modules.reels.fetch_youtube",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "YouTube",
        ),
    ],
)
def test_the_download_uses_the_tool_for_the_site(
    monkeypatch, tmp_path, shortcode, module, target, site
):
    import subprocess

    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        (tmp_path / "meta.json").write_text('{"caption": "hi"}')
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(service.subprocess, "run", run)
    assert service.download(shortcode, tmp_path) == {"caption": "hi"}
    assert calls[0][1:4] == ["-m", module, target]


@pytest.mark.parametrize(
    ("code", "words"),
    [
        (2, "private, age-restricted or removed"),
        (3, "YouTube is not letting us read videos"),
        (4, "live stream"),
        (6, "longer than 3 minutes"),
        (5, "couldn't download that video"),
    ],
)
def test_a_youtube_failure_says_why(monkeypatch, tmp_path, code, words):
    import subprocess

    monkeypatch.setattr(
        service.subprocess,
        "run",
        lambda cmd, **kw: subprocess.CompletedProcess(cmd, code, "", "boom"),
    )
    with pytest.raises(service.ReelError) as err:
        service.download("yt-dQw4w9WgXcQ", tmp_path)
    assert words in str(err.value)


def test_a_youtube_video_is_cached_under_its_own_id():
    assert service.youtube_shortcode("dQw4w9WgXcQ") == "yt-dQw4w9WgXcQ"
    assert service.canonical_url("yt-dQw4w9WgXcQ") == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert service.canonical_url("Cabc123xyz") == "https://www.instagram.com/reel/Cabc123xyz/"
