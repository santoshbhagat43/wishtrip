"""Cut a reel into scene frames and an audio track, and read the text on the frames."""

import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

# A frame at every scene change, plus one at least every `gap` seconds so captions that change
# over the same shot are still read.
SCENE_FILTER = (
    "select='gt(scene\\,0.3)+isnan(prev_selected_t)+gte(t-prev_selected_t\\,{gap})',"
    "scale=720:-2,showinfo"
)
PTS_TIME = re.compile(r"pts_time:\s*([\d.]+)")


class MediaError(RuntimeError):
    pass


@dataclass
class Probe:
    duration: float
    has_audio: bool


@dataclass
class Frame:
    t: float
    path: Path


def _run(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{cmd[0]} timed out") from exc
    if result.returncode != 0:
        raise MediaError(f"{cmd[0]} failed: {result.stderr.strip()[-300:]}")
    return result


def probe(video: Path) -> Probe:
    out = _run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(video)]
    )
    data = json.loads(out.stdout or "{}")
    streams = data.get("streams", [])
    if not any(s.get("codec_type") == "video" for s in streams):
        raise MediaError("The file has no video stream")
    return Probe(
        duration=float(data.get("format", {}).get("duration") or 0),
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
    )


def frames(video: Path, outdir: Path, max_frames: int, duration: float = 0) -> list[Frame]:
    """Scene-change frames with their timestamps (ffmpeg's showinfo prints one line per frame).
    The sampling gap grows with the video so the frame budget covers all of it."""
    outdir.mkdir(parents=True, exist_ok=True)
    gap = max(1.0, round(duration / (max_frames * 0.7), 1)) if duration else 1.0
    result = _run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "info", "-i", str(video),
            "-vf", SCENE_FILTER.format(gap=gap), "-fps_mode", "vfr", "-frames:v", str(max_frames),
            "-q:v", "3", str(outdir / "f_%04d.jpg"),
        ],
        timeout=180,
    )  # fmt: skip
    times = [float(m) for m in PTS_TIME.findall(result.stderr)]
    files = sorted(outdir.glob("f_*.jpg"))
    return [Frame(t=times[i] if i < len(times) else 0.0, path=p) for i, p in enumerate(files)]


def spread(frame_list: list[Frame], count: int) -> list[Frame]:
    """`count` frames spread evenly over the video, in time order (all of them if fewer)."""
    if count <= 0 or not frame_list:
        return []
    if len(frame_list) <= count:
        return list(frame_list)
    last = len(frame_list) - 1
    picks = sorted({round(i * last / (count - 1)) for i in range(count)}) if count > 1 else [0]
    return [frame_list[i] for i in picks]


def audio(video: Path, out: Path) -> Path:
    """Mono 16 kHz mp3: small enough to send whole, enough for speech."""
    _run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
         "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", str(out)],
        timeout=120,
    )  # fmt: skip
    return out


# OCR ---------------------------------------------------------------------------------------


def _languages() -> str:
    import pytesseract

    try:
        have = set(pytesseract.get_languages(config=""))
    except Exception:
        return "eng"
    # Indian travel reels often overlay Hindi; use it when the language pack is installed.
    return "+".join(lang for lang in ("eng", "hin") if lang in have) or "eng"


def clean_line(line: str) -> str | None:
    """Keep lines that read like words, not OCR noise from textures and logos."""
    line = re.sub(r"\s+", " ", line).strip(" |_~-—•·*'\"`")
    if len(line) < 3:
        return None
    letters = sum(ch.isalpha() for ch in line)
    if letters / len(line) < 0.6:
        return None
    if not re.search(r"[^\W\d_]{3,}", line):
        return None
    return line


def _key(line: str) -> str:
    return re.sub(r"[\W_]+", "", line.lower())


def _read_frame(path: Path, lang: str) -> str:
    import pytesseract
    from PIL import Image, ImageOps

    with Image.open(path) as img:
        gray = ImageOps.autocontrast(ImageOps.grayscale(img))
        # psm 11: sparse text, the way captions float over video.
        return pytesseract.image_to_string(gray, lang=lang, config="--psm 11")


# A frame counts as the same screen when fewer than this share of its pixels (on a small grey
# copy) differ clearly from a frame already read. A new caption line changes about 1%.
SAME_SCREEN = 0.004


def _thumb(path: Path):
    from PIL import Image, ImageOps

    with Image.open(path) as img:
        return ImageOps.grayscale(img).resize((160, 284))


def new_screens(frame_list: list[Frame]) -> list[Frame]:
    """The frames worth reading: drops those that show the same screen as one already kept, so a
    held shot or a caption that stays up is read once. Their text would be skipped as a repeat
    anyway; this just doesn't spend OCR time finding that out."""
    from PIL import ImageChops

    kept: list[Frame] = []
    thumbs = []
    for frame in frame_list:
        thumb = _thumb(frame.path)
        for other in thumbs:
            hist = ImageChops.difference(thumb, other).histogram()
            if sum(hist[48:]) / (160 * 284) < SAME_SCREEN:
                break
        else:
            kept.append(frame)
            thumbs.append(thumb)
    return kept


def ocr(frame_list: list[Frame], workers: int | None = None) -> list[dict]:
    """Text on screen, once per line: overlays stay up across many frames.

    Frames are read in parallel (Tesseract runs as a subprocess, so threads are enough) and
    merged in frame order, so the result is the same as reading them one by one."""
    from app.core.config import settings

    frame_list = new_screens(frame_list)
    if not frame_list:
        return []
    # One Tesseract thread per frame: several frames at once beats one frame on all cores.
    os.environ.setdefault("OMP_THREAD_LIMIT", "1")
    lang = _languages()
    workers = max(1, workers or settings.reel_ocr_workers or os.cpu_count() or 1)
    with ThreadPoolExecutor(max_workers=min(workers, len(frame_list))) as pool:
        texts = list(pool.map(lambda f: _read_frame(f.path, lang), frame_list))
    seen: set[str] = set()
    lines: list[dict] = []
    for frame, text in zip(frame_list, texts, strict=True):
        for raw in text.splitlines():
            line = clean_line(raw)
            if not line or _key(line) in seen:
                continue
            seen.add(_key(line))
            lines.append({"t": round(frame.t, 1), "text": line})
    return lines
