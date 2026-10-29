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
    client, traveler, admin, london, fake_instagram, builds
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
    assert detail["itineraries"] == []
    assert (await client.get("/reels/admin/imports", headers=auth(traveler))).status_code == 403

    # Staff build the itinerary a couple would get, for the days the video says (2 here).
    built = await client.post(
        f"/reels/admin/imports/{job['id']}/itinerary", json={}, headers=as_staff
    )
    assert built.status_code == 202, built.text
    assert built.json()["days"] == 2 and builds == [built.json()["code"]]
    detail = (await client.get(f"/reels/admin/imports/{job['id']}", headers=as_staff)).json()
    [trip] = detail["itineraries"]
    assert (trip["code"], trip["days"], trip["adults"], trip["group"]) == (
        built.json()["code"],
        2,
        2,
        "couple",
    )
    assert trip["build_status"] == "building" and trip["items"]
    no = await client.post(
        f"/reels/admin/imports/{job['id']}/itinerary", json={}, headers=auth(traveler)
    )
    assert no.status_code == 403

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


def test_a_screen_that_repeats_is_read_once_but_a_new_caption_is_kept(tmp_path):
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.load_default(size=48)

    def shot(name: str, caption: str) -> media.Frame:
        img = Image.new("RGB", (720, 1280), (30, 60, 90))
        ImageDraw.Draw(img).text((60, 600), caption, fill="white", font=font)
        path = tmp_path / f"{name}.png"
        img.save(path)
        return media.Frame(t=float(len(list(tmp_path.glob("*.png")))), path=path)

    frames = [
        shot("a", "Tower Bridge"),
        shot("b", "Tower Bridge"),  # the same screen held
        shot("c", "Borough Market"),  # same shot, new caption
        shot("d", "Tower Bridge"),  # an earlier screen coming back
    ]
    assert [f.path.stem for f in media.new_screens(frames)] == ["a", "c"]


async def _imports(client, admin, **params):
    r = await client.get("/reels/admin/imports", params=params, headers=auth(admin))
    assert r.status_code == 200, r.text
    return r.json()


async def test_staff_page_through_and_search_the_import_list(client, admin, traveler):
    from datetime import UTC, datetime, timedelta

    from app.modules.reels.models import ImportStatus, ReelImport

    async with SessionLocal() as session:
        now = datetime.now(UTC)
        for i in range(7):
            session.add(
                ReelImport(
                    url=f"https://www.instagram.com/reel/Code{i}/",
                    shortcode=f"Code{i}",
                    user_id=traveler.id,
                    status=ImportStatus.FAILED if i % 3 == 0 else ImportStatus.DONE,
                    error="Instagram said no" if i % 3 == 0 else "",
                    finished_at=now,
                    created_at=now - timedelta(minutes=i),  # Code0 is the newest
                )
            )
        await session.commit()

    first = await _imports(client, admin, page=1, page_size=3)
    assert [i["shortcode"] for i in first["items"]] == ["Code0", "Code1", "Code2"]
    assert (first["total"], first["page"], first["page_size"]) == (7, 1, 3)
    last = await _imports(client, admin, page=3, page_size=3)
    assert [i["shortcode"] for i in last["items"]] == ["Code6"]
    assert (await _imports(client, admin, page=4, page_size=3))["items"] == []

    # Search by a piece of the link, the error, or who asked; the totals still cover everything.
    by_code = await _imports(client, admin, q="code4")
    assert [i["shortcode"] for i in by_code["items"]] == ["Code4"] and by_code["total"] == 1
    assert by_code["totals"]["total"] == 7
    by_error = await _imports(client, admin, q="said no")
    assert sorted(i["shortcode"] for i in by_error["items"]) == ["Code0", "Code3", "Code6"]
    by_person = await _imports(client, admin, q=traveler.email.split("@")[0])
    assert by_person["total"] == 7
    assert (await _imports(client, admin, q="nobody-has-this"))["total"] == 0
    # A typed % or _ is not a wildcard.
    assert (await _imports(client, admin, q="%"))["total"] == 0
    assert (await _imports(client, admin, q="_"))["total"] == 0

    # Filter by state, and combine it with a search.
    failed = await _imports(client, admin, status="failed")
    assert failed["total"] == 3 and {i["status"] for i in failed["items"]} == {"failed"}
    assert (await _imports(client, admin, status="done"))["total"] == 4
    assert (await _imports(client, admin, status="failed", q="Code3"))["total"] == 1
    assert (await _imports(client, admin, status="in_progress"))["total"] == 0
    bad = await client.get("/reels/admin/imports?page_size=1000", headers=auth(admin))
    assert bad.status_code == 422


async def test_an_area_the_reel_mentions_is_not_matched_to_a_stop_so_it_cannot_move_the_trip(
    client, london
):
    """A Dubai reel says "from Delhi or Mumbai". The area "Delhi" must not be matched to some
    restaurant called Delhi (here: a place that is in London) and drag the whole trip there."""
    from app.modules.reels.understand import Reading

    reading = Reading(
        destination="Dubai",
        places=[
            {
                "name": "Borough Market",
                "kind": "area",
                "evidence": "fly from",
                "source": "voice",
                "t": None,
            },
            {
                "name": "Burj Khalifa",
                "kind": "sight",
                "evidence": "caption",
                "source": "caption",
                "t": None,
            },
        ],
    )
    async with SessionLocal() as session:
        destination, places = await service.match_places(
            session, AIOrchestrator(client=ReelAI()), reading
        )
    assert destination is None  # Dubai is not in the knowledge base, and nothing moved it to London
    area = next(p for p in places if p["kind"] == "area")
    assert area["verified"] is False and area["location_id"] is None


class ScreenAI(ReelAI):
    MODELS = {**ReelAI.MODELS, "screen": "google/gemini-2.5-flash"}

    async def chat(self, task, messages, **kwargs):
        if task == "screen":
            self.calls.append((task, messages))
            return json.dumps(
                {
                    "frames": [
                        {"n": 2, "lines": ["Le Morne", "Swing by  Caudan"]},
                        {"n": 1, "lines": ["Mauritius isn't one"]},
                        {"n": 3, "lines": ["le morne", ""]},  # a repeat and a blank
                        {"n": 9, "lines": ["no such frame"]},
                    ]
                }
            )
        return await super().chat(task, messages, **kwargs)


async def test_a_vision_model_reads_the_screen(tmp_path):
    from PIL import Image

    from app.modules.reels.understand import read_screen

    frames = []
    for i, t in enumerate((0.0, 4.2, 8.0)):
        path = tmp_path / f"f{i}.jpg"
        Image.new("RGB", (720, 1280), (30, 60, 90)).save(path)
        frames.append(media.Frame(t=t, path=path))
    ai = ScreenAI()
    lines = await read_screen(AIOrchestrator(client=ai), frames)
    assert lines == [
        {"t": 0.0, "text": "Mauritius isn't one"},
        {"t": 4.2, "text": "Le Morne"},
        {"t": 4.2, "text": "Swing by Caudan"},
    ]
    content = ai.calls[0][1][0]["content"]
    assert sum(1 for part in content if part["type"] == "image_url") == 3


def _stt(monkeypatch, handler):
    import httpx

    from app.modules.reels import understand

    real = httpx.AsyncClient
    monkeypatch.setattr(settings, "sst_model", "x-ai/grok-stt-1.0")
    monkeypatch.setattr(settings, "openrouter_api_key", "or-test")
    monkeypatch.setattr(
        understand.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )
    monkeypatch.setattr(media, "audio", lambda video, out: (out.write_bytes(b"mp3"), out)[1])


class SpeechAI(ReelAI):
    async def chat(self, task, messages, **kwargs):
        if task == "intent" and "speech from a travel video" in messages[0]["content"]:
            self.calls.append((task, messages))
            return json.dumps({"language": "hi", "english": "Go to Le Morne at sunset."})
        return await super().chat(task, messages, **kwargs)


async def test_the_speech_model_hears_the_voice_over(monkeypatch, tmp_path):
    import httpx

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.update(url=str(request.url), auth=request.headers["authorization"],
                    model=body["model"], format=body["input_audio"]["format"])  # fmt: skip
        return httpx.Response(200, json={"text": "Shaam ko Le Morne jao.", "usage": {"seconds": 3}})

    _stt(monkeypatch, handler)
    ai = SpeechAI()
    heard = await service.listen(AIOrchestrator(client=ai), tmp_path / "v.mp4", tmp_path, True)
    assert (heard.text, heard.language, heard.english) == (
        "Shaam ko Le Morne jao.",
        "hi",
        "Go to Le Morne at sunset.",
    )
    assert seen == {
        "url": "https://openrouter.ai/api/v1/audio/transcriptions",
        "auth": "Bearer or-test",
        "model": "x-ai/grok-stt-1.0",
        "format": "mp3",
    }
    assert [task for task, _ in ai.calls] == ["intent"]  # Gemini wasn't needed


async def test_the_speech_model_failing_falls_back_to_gemini(monkeypatch, tmp_path):
    import httpx

    _stt(monkeypatch, lambda request: httpx.Response(503, json={"error": "busy"}))
    ai = ReelAI()
    heard = await service.listen(AIOrchestrator(client=ai), tmp_path / "v.mp4", tmp_path, True)
    assert "Borough Market" in heard.text
    assert [task for task, _ in ai.calls] == ["transcribe"]


class TownAI(ReelAI):
    MODELS = {**ReelAI.MODELS, "reader": "google/gemini-2.5-flash"}

    async def chat(self, task, messages, **kwargs):
        if task == "reader" and "You place travel stops in towns" in messages[0]["content"]:
            self.calls.append((task, messages))
            return json.dumps(
                {"towns": {"Helicopter ride over the underwater waterfall": "Le Morne"}}
            )
        return await super().chat(task, messages, **kwargs)


async def test_staff_publish_a_reels_unknown_places(client, admin, traveler):
    from app.modules.knowledge.models import Location, LocationType
    from app.modules.reels.models import CreatorContent, ImportStatus, ReelImport

    def place(name, kind):
        return {"name": name, "kind": kind, "evidence": name.lower(), "source": "voice",
                "verified": False, "location_id": None}  # fmt: skip

    async with SessionLocal() as session:
        content = CreatorContent(
            shortcode="mu-test-1", url="", caption="", destination_name="Mauritius",
            extracted={"destination": "Mauritius", "country": "Mauritius"},
            places=[
                place("South of Mauritius", "area"),
                place("Chamarel", "area"),
                place("Rum tasting at Chamarel", "experience"),
                place("Helicopter ride over the underwater waterfall", "experience"),
            ],
        )  # fmt: skip
        session.add(content)
        await session.flush()
        job = ReelImport(url="", shortcode="mu-test-1", user_id=traveler.id,
                         content_id=content.id, status=ImportStatus.DONE)  # fmt: skip
        session.add(job)
        await session.commit()
        job_id = job.id

    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=TownAI())
    try:
        url = f"/reels/admin/imports/{job_id}/places"
        assert (await client.post(url, headers=auth(traveler))).status_code == 403
        r = await client.post(url, headers=auth(admin))
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    added = {(a["name"], a["type"], a["town"]) for a in r.json()["added"]}
    assert added == {
        ("Mauritius", "country", ""),
        ("Chamarel", "city", "Mauritius"),
        ("Le Morne", "city", "Mauritius"),
        ("Rum tasting at Chamarel", "experience", "Chamarel"),
        ("Helicopter ride over the underwater waterfall", "experience", "Le Morne"),
    }
    assert [s["name"] for s in r.json()["skipped"]] == ["South of Mauritius"]

    detail = (await client.get(f"/reels/admin/imports/{job_id}", headers=auth(admin))).json()
    verified = {p["name"]: p["verified"] for p in detail["place_list"]}
    assert verified == {
        "South of Mauritius": False,
        "Chamarel": True,
        "Rum tasting at Chamarel": True,
        "Helicopter ride over the underwater waterfall": True,
    }
    async with SessionLocal() as session:
        heli = await session.scalar(
            select(Location).where(Location.name == "Helicopter ride over the underwater waterfall")
        )
        assert heli.type == LocationType.EXPERIENCE and heli.status.value == "published"
        assert heli.source == "reel" and heli.provenance["needs_verification"]

    # A second press adds nothing new, even for a place now named a little differently: the
    # reel is matched against our places before anything is added.
    async with SessionLocal() as session:
        row = await session.get(CreatorContent, content.id)
        row.places = [*row.places, place("Rum Tasting in Chamarel", "experience")]
        await session.commit()
    app.dependency_overrides[get_orchestrator] = lambda: AIOrchestrator(client=TownAI())
    try:
        again = (await client.post(url, headers=auth(admin))).json()
    finally:
        app.dependency_overrides.clear()
    assert again["added"] == []
    detail = (await client.get(f"/reels/admin/imports/{job_id}", headers=auth(admin))).json()
    # Matched to the place already added, so it is one place on the reel, not two.
    names = [p["name"] for p in detail["place_list"]]
    assert "Rum tasting at Chamarel" in names and "Rum Tasting in Chamarel" not in names
