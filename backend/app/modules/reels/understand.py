"""Turn what a reel says (voice) and shows (caption + text on screen) into places."""

import asyncio
import base64
import logging
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

import httpx

from app.ai.orchestrator import AIOrchestrator, parse_json_object
from app.core.config import settings

logger = logging.getLogger(__name__)

TRANSCRIBE_PROMPT = """Transcribe the speech in this audio from a short travel video.
Return JSON only:
{"language": "<ISO 639-1 code of the speech, or empty>",
 "transcript": "<the speech verbatim, in its original language>",
 "english": "<an English translation; repeat the transcript if it is already English>",
 "segments": [{"start": <seconds from the start of the audio when this part is said>,
               "text": "<that part of the speech, verbatim>"}],
 "music_only": <true when there is no speech, only music or noise>}
Split the speech into segments of about 5 seconds, at sentence or phrase breaks, in order; their
texts together are the whole transcript. Do not describe the music. Do not add anything that is
not said."""

TRANSLATE_PROMPT = """This is speech from a travel video. Return JSON only:
{"language": "<ISO 639-1 code of the speech>",
 "english": "<an English translation, keeping place names as they are; empty if it is already
English>"}"""

SCREEN_PROMPT = """These are frames from a short travel video, in time order, each labelled with
its number. Read the text a viewer sees on screen: captions, subtitles, titles, place names,
prices, signs and labels. Copy it exactly as written, one line per caption line. Skip watermarks,
app logos and usernames. Look at every frame: a caption that is up for a single frame still
counts, and a caption that changes by one word is a new line. If a caption stays up across
frames, give it once, on the first frame it shows.
Return JSON only: {"frames": [{"n": 1, "lines": ["..."]}]}, listing only frames that have text."""

EXTRACT_PROMPT = """You read travel reels. From the caption, the text shown on screen and the
voice-over below, list the real places the reel shows or recommends.

Rules:
- Only places that are named in the material. Never add places from your own knowledge.
- "name" is the place's full, proper name, the way a traveller would search it on a map:
  - The voice-over is machine-transcribed and mishears names ("Kudon" is "Caudan", "Limon" is
    "Le Morne", "true or witches" is "Trou aux Biches"). When the text on screen spells a name,
    use the screen's spelling. Otherwise correct a misheard name to the real place it clearly
    is in that destination. Keep the creator's words in "evidence".
  - Give the place its full name: "Caudan Waterfront", not "Caudan"; "Flic en Flac Beach"
    when the creator means the beach.
  - Never a bare direction or a word that means nothing alone. "south" is "South of Mauritius",
    "north-west" is "North-west coast of Mauritius", "the old town" is "Old Town, Tallinn".
  - Name each place once. "Le Morne" and "Le Morne Brabant" are one place.
- List every place and activity the creator names; do not skip any. Each named sight, beach,
  park, viewpoint, waterfall and market is its own place, and so is each named activity (a
  submarine dive, a catamaran cruise, a helicopter ride, a rum tasting), named with where it is:
  "Catamaran cruise at Tamarin", "Rum tasting at Chamarel".
- "evidence" must quote the words from the material that name the place (copy them exactly).
- "source" is where the evidence is: "caption", "screen" or "voice".
- "t" is always null: timestamps are worked out separately.
- Every town or city the creator travels to, stays in or passes through is an "area" place, with
  the day they reach it. Do not leave one out because no sight is named there.
- "day" is the day number the creator says the place belongs to ("Day 1", "on the second day"),
  only when the material says so in words. Otherwise null. Never work a day out yourself.
- kind is one of: "stay" (hotel, villa, homestay), "food" (restaurant, cafe, bar, dish spot),
  "sight" (beach, fort, church, viewpoint, market), "experience" (cruise, tour, activity),
  "area" (a town or neighbourhood).
- Prices, phone numbers and discount codes are not places. Ignore them.
- tips: short practical advice the creator gives (best time, what to avoid), in English.
- "days_said" is the trip length in the creator's own words ("7 to 8 days", "a weekend"), or
  empty when they don't say. "days_hint" is that length as one number (the larger end of a
  range), or null.
- "legs" is how the creator splits the trip, in their order, when they say so: which days as day
  numbers ("1-4", "5-8", counted over "days_hint"), the area, and where to stay. Empty when they
  don't split it.

Return JSON only:
{"destination": "<city or region the reel is about, or empty>",
 "country": "<country or empty>",
 "summary": "<one sentence on what the reel is about>",
 "days_said": "<the trip length as the creator says it, or empty>",
 "days_hint": <number of days the creator suggests, or null>,
 "legs": [{"days": "<e.g. 1-4>", "area": "<proper area name>",
           "stay": "<where to base, or empty>"}],
 "places": [{"name": "...", "kind": "...", "evidence": "...", "source": "...",
              "day": null, "t": null}],
 "tips": ["..."]}"""

KINDS = {"stay", "food", "sight", "experience", "area"}
SOURCES = {"caption", "screen", "voice"}


@dataclass
class Transcript:
    text: str = ""
    language: str = ""
    english: str = ""
    # The speech with its times: [{"t": seconds, "text": "..."}], in order. Empty when unknown.
    segments: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Reading:
    destination: str = ""
    country: str = ""
    summary: str = ""
    days_hint: int | None = None
    days_said: str = ""
    legs: list[dict[str, str]] = field(default_factory=list)
    places: list[dict[str, Any]] = field(default_factory=list)
    tips: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "destination": self.destination,
            "country": self.country,
            "summary": self.summary,
            "days_hint": self.days_hint,
            "days_said": self.days_said,
            "legs": self.legs,
            "places": self.places,
            "tips": self.tips,
        }


async def transcribe(ai: AIOrchestrator, mp3: bytes) -> Transcript:
    """Gemini (through OpenRouter) listens to the audio. Empty when there is no speech."""
    raw = await ai.complete(
        "transcribe",
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": TRANSCRIBE_PROMPT},
                    {
                        "type": "input_audio",
                        "input_audio": {"data": base64.b64encode(mp3).decode(), "format": "mp3"},
                    },
                ],
            }
        ],
        json_mode=True,
        temperature=0,
        max_tokens=4000,
        timeout=180,
    )
    data = parse_json_object(raw)
    if data.get("music_only"):
        return Transcript()
    text = str(data.get("transcript") or "").strip()
    return Transcript(
        text=text,
        language=str(data.get("language") or "")[:32],
        english=str(data.get("english") or text).strip(),
        segments=timed(data.get("segments"), "start"),
    )


def timed(parts: Any, start: str) -> list[dict[str, Any]]:
    """[{start, text}] from a model or a speech API → [{"t", "text"}], in time order, with the
    ones that have no usable time or text left out."""
    out = []
    for part in parts if isinstance(parts, list) else []:
        if not isinstance(part, dict):
            continue
        t, text = part.get(start), re.sub(r"\s+", " ", str(part.get("text") or "")).strip()
        if isinstance(t, int | float) and t >= 0 and text:
            out.append({"t": round(float(t), 1), "text": text})
    return sorted(out, key=lambda part: part["t"])


async def transcribe_stt(ai: AIOrchestrator, mp3: bytes) -> Transcript:
    """A speech-to-text model (SST_MODEL, through OpenRouter) transcribes the audio, with times
    when it can give them. The chat model names the language and translates when it isn't
    English."""
    body: dict[str, Any] = {
        "model": settings.sst_model,
        "input_audio": {"data": base64.b64encode(mp3).decode(), "format": "mp3"},
        # Times with the words; providers that can't give them refuse, and are asked again
        # for the text alone.
        "response_format": "verbose_json",
        "timestamp_granularities": ["segment"],
    }
    async with httpx.AsyncClient(timeout=180) as client:
        url = f"{settings.openrouter_base_url.rstrip('/')}/audio/transcriptions"
        headers = {"authorization": f"Bearer {settings.openrouter_api_key}"}
        res = await client.post(url, headers=headers, json=body)
        if res.status_code == 400:
            body.pop("response_format"), body.pop("timestamp_granularities")
            res = await client.post(url, headers=headers, json=body)
    if res.status_code >= 400:
        raise ValueError(f"{settings.sst_model} answered {res.status_code}: {res.text[:200]}")
    segments = timed(res.json().get("segments"), "start")
    text = str(res.json().get("text") or "").strip()
    if not text:
        return Transcript()
    language, english = "", text
    if ai.supports("intent"):
        try:
            data = await ai.complete_json(
                "intent",
                [
                    {"role": "system", "content": TRANSLATE_PROMPT},
                    {"role": "user", "content": text},
                ],
                timeout=60,
            )
            language = str(data.get("language") or "")[:32]
            english = str(data.get("english") or "").strip() or text
        except Exception as exc:  # noqa: BLE001 - the transcript still reads without it
            logger.warning("Naming the voice-over's language failed: %s", exc)
    return Transcript(text=text, language=language, english=english, segments=segments)


def _jpeg(path: Any) -> str:
    import io

    from PIL import Image

    with Image.open(path) as img:
        img = img.convert("RGB")
        img.thumbnail((540, 960))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()


async def _read_batch(ai: AIOrchestrator, frames: list[Any]) -> list[dict]:
    content: list[dict[str, Any]] = [{"type": "text", "text": SCREEN_PROMPT}]
    images = await asyncio.gather(*(asyncio.to_thread(_jpeg, f.path) for f in frames))
    for n, (frame, image) in enumerate(zip(frames, images, strict=True), 1):
        content.append({"type": "text", "text": f"Frame {n} ({frame.t:.1f}s)"})
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image}"}}
        )
    raw = await ai.complete(
        "screen", [{"role": "user", "content": content}],
        json_mode=True, temperature=0, max_tokens=None, timeout=120,
    )  # fmt: skip
    lines: list[dict] = []
    for item in parse_json_object(raw).get("frames") or []:
        n = item.get("n") if isinstance(item, dict) else None
        if not isinstance(n, int) or not 1 <= n <= len(frames):
            continue
        for text in item.get("lines") or []:
            text = re.sub(r"\s+", " ", str(text)).strip()
            if text:
                lines.append({"t": round(frames[n - 1].t, 1), "text": text})
    return lines


async def read_screen(ai: AIOrchestrator, frames: list[Any], batch: int = 30) -> list[dict]:
    """A vision model reads the text on every frame (`media.Frame`s, in time order), in batches
    read side by side, as [{"t": seconds, "text": line}] with each line once, where it first
    shows. A batch that fails is asked again once; if it fails again, the whole read fails."""
    batch = max(1, batch)
    chunks = [frames[i : i + batch] for i in range(0, len(frames), batch)]

    async def one(chunk: list[Any]) -> list[dict]:
        try:
            return await _read_batch(ai, chunk)
        except Exception as exc:  # noqa: BLE001 - the provider now and then fails a call
            logger.warning("Reading frames failed once, asking again: %s", exc)
            return await _read_batch(ai, chunk)

    seen: set[str] = set()
    lines: list[dict] = []
    for line in sorted(
        (line for found in await asyncio.gather(*(one(c) for c in chunks)) for line in found),
        key=lambda line: line["t"],
    ):
        key = re.sub(r"[\W_]+", "", line["text"].lower())
        if key and key not in seen:
            seen.add(key)
            lines.append(line)
    return lines


def material(caption: str, hashtags: list[str], location: str, ocr_lines: list[dict],
             transcript: Transcript, source: dict | None = None) -> str:  # fmt: skip
    parts = [f"CAPTION:\n{caption.strip() or '(none)'}"]
    # What the platform says about the post: its title, when the caption doesn't already start
    # with it. (Not the author's name: a handle like "BaliDreams" would make "Bali" look named.)
    title = str((source or {}).get("title") or "").strip()
    if title and not caption.strip().startswith(title[:60]):
        parts.insert(0, f"TITLE: {title}")

    if hashtags:
        parts.append("HASHTAGS: " + " ".join(f"#{h}" for h in hashtags))
    if location:
        parts.append(f"LOCATION TAG: {location}")
    screen = "\n".join(f"[{line['t']}s] {line['text']}" for line in ocr_lines)
    parts.append(f"TEXT ON SCREEN:\n{screen or '(none)'}")
    voice = transcript.text
    if transcript.english and transcript.english != transcript.text:
        voice += f"\n(English: {transcript.english})"
    parts.append(f"VOICE-OVER:\n{voice or '(none)'}")
    return "\n\n".join(parts)


def _norm(text: str) -> str:
    return re.sub(r"[\W_]+", " ", text.lower()).strip()


_DAY_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
_ORDINALS = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
]


def stated_day(value: Any, corpus: str) -> int | None:
    """A day the model gives a place, kept only when the material really says that day ("day 2",
    "day two", "second day"): a model's own idea of the order is not the creator's."""
    if isinstance(value, str) and value.strip().isdigit():  # models often answer "2"
        value = int(value.strip())
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 30:
        return None
    patterns = [rf"\bday\s*(?:no\s*)?{value}\b"]
    if value <= len(_DAY_WORDS):
        patterns += [rf"\bday\s*{_DAY_WORDS[value - 1]}\b", rf"\b{_ORDINALS[value - 1]}\s+day\b"]
    return value if any(re.search(p, corpus) for p in patterns) else None


def grounded(place: dict[str, Any], corpus: str) -> bool:
    """The place must really be in the material: its evidence or a word of its name."""
    evidence = _norm(str(place.get("evidence") or ""))
    if evidence and evidence in corpus:
        return True
    words = [w for w in _norm(str(place.get("name") or "")).split() if len(w) >= 4]
    return any(re.search(rf"\b{re.escape(w)}\b", corpus) for w in words)


# Words that say what a place is, not which one ("beach", "temple"): not proof of a match.
_KIND_WORDS = {
    "cafe", "restaurant", "beach", "fort", "hotel", "resort", "villa", "market", "temple",
    "church", "lake", "bar", "bistro", "kitchen", "house", "view", "viewpoint", "point",
    "island", "falls", "trek", "tour", "cruise", "north", "south", "east", "west", "old", "new",
    "warung", "pura", "the", "and", "day",
}  # fmt: skip


def _close(word: str, seen: str) -> bool:
    """Equal, or nearly. OCR clips letters off the edges of a word ("jwatu" for "uluwatu") and
    misreads others, so a long run of the same letters counts when it sits at the start or end of
    both words: that is what clipping leaves, and what a coincidence in the middle isn't."""
    matcher = SequenceMatcher(None, word, seen)
    if matcher.ratio() >= 0.8:
        return True
    m = matcher.find_longest_match(0, len(word), 0, len(seen))

    def at_edge(start: int, size: int, length: int) -> bool:
        return start == 0 or start + size == length

    return (
        m.size >= 4
        and m.size >= 0.6 * min(len(word), len(seen))
        and at_edge(m.a, m.size, len(word))
        and at_edge(m.b, m.size, len(seen))
    )


def seen_on_screen(name: str, ocr_lines: list[dict]) -> float | None:
    """The second a place first shows on screen, from the text actually read off the frames.

    Voice-overs carry no timestamps and a model will happily invent one, so a time is only ever
    this: the earliest line whose text shares a distinctive word with the place's name.
    """
    words = [w for w in _norm(name).split() if len(w) >= 4 and w not in _KIND_WORDS]
    if not words:
        return None
    for line in sorted(ocr_lines, key=lambda x: x["t"]):
        have = [h for h in _norm(str(line["text"])).split() if len(h) >= 4]
        if any(_close(w, h) for w in words for h in have):
            return float(line["t"])
    return None


# A direction alone ("south") names no place: it is part of the destination.
_DIRECTIONS = re.compile(
    r"(?:the\s+)?(north|south|east|west|central|north[\s-]?east|north[\s-]?west|"
    r"south[\s-]?east|south[\s-]?west)(?:\s+(?:coast|side|part))?",
    re.I,
)


def _placed(name: str, destination: str) -> str:
    """ "south" → "South of Mauritius": a bare direction becomes that part of the destination."""
    m = _DIRECTIONS.fullmatch(name.strip())
    if not m or not destination:
        return name
    return f"{name.strip().removeprefix('the ').removeprefix('The ').capitalize()} of {destination}"


def clean_reading(data: dict[str, Any], text: str, ocr_lines: list[dict] | None = None) -> Reading:
    corpus = _norm(text)
    destination = str(data.get("destination") or "").strip()[:120]
    places: list[dict[str, Any]] = []
    seen: set[str] = set()
    for p in data.get("places") or []:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()[:200]
        if name.isupper():  # on-screen captions are often in capitals
            name = name.title()
        name = _placed(name, destination)
        if not name or _norm(name) in seen or not grounded(p, corpus):
            continue
        seen.add(_norm(name))
        # Never the model's own guess at a time: only when the name really appeared on screen.
        t = seen_on_screen(name, ocr_lines or [])
        places.append(
            {
                "name": name,
                "kind": p.get("kind") if p.get("kind") in KINDS else "sight",
                "evidence": str(p.get("evidence") or "").strip()[:300],
                "source": p.get("source") if p.get("source") in SOURCES else "caption",
                "video_day": stated_day(p.get("day"), corpus),
                "t": t,
            }
        )
    days = data.get("days_hint")
    legs = [
        {k: _placed(str(leg.get(k) or "").strip()[:120], destination) if k == "area"
         else str(leg.get(k) or "").strip()[:120] for k in ("days", "area", "stay")}
        for leg in data.get("legs") or [] if isinstance(leg, dict) and leg.get("area")
    ][:6]  # fmt: skip
    return Reading(
        destination=destination,
        days_said=str(data.get("days_said") or "").strip()[:60],
        legs=legs,
        country=str(data.get("country") or "").strip()[:120],
        summary=str(data.get("summary") or "").strip()[:400],
        days_hint=days if isinstance(days, int) and 0 < days <= 30 else None,
        places=places,
        tips=[str(t).strip()[:200] for t in (data.get("tips") or []) if str(t).strip()][:8],
    )


# Strict: a caption stands in for the video only when it is plainly an itinerary.
CAPTION_MIN_PLACES = 8  # that many named places make a trip on their own...
CAPTION_MIN_DAYS = 2  # ...or a day-by-day layout ("Day 1: …", "Day 2: …") of at least
CAPTION_MIN_DAY_PLACES = 4  # this many places.


def caption_is_enough(reading: Reading) -> tuple[bool, str]:
    """Whether what the creator wrote is a whole itinerary, so the video need not be read, and why
    (or why not) in words staff can read in the import log."""
    stops = [p for p in reading.places if p.get("kind") != "area"]
    days = {p["video_day"] for p in stops if p.get("video_day")}
    if not reading.destination:
        return False, "the caption does not say where the trip is"
    if len(days) >= CAPTION_MIN_DAYS and len(stops) >= CAPTION_MIN_DAY_PLACES:
        return True, f"it lays out {len(days)} days and names {len(stops)} places"
    if len(stops) >= CAPTION_MIN_PLACES:
        return True, f"it names {len(stops)} places"
    return False, f"it names only {len(stops)} places and no day-by-day plan"


async def read_places(
    ai: AIOrchestrator, text: str, ocr_lines: list[dict] | None = None
) -> Reading:
    """The places in what the reel said and showed. The model provider is now and then at
    capacity or returns broken JSON: try up to three times before giving the import up."""
    last: Exception | None = None
    for attempt in range(3):
        try:
            raw = await ai.complete(
                "reader" if ai.supports("reader") else "planner",
                [{"role": "system", "content": EXTRACT_PROMPT}, {"role": "user", "content": text}],
                json_mode=True,
                temperature=0.1,
                max_tokens=None,
            )
            return clean_reading(parse_json_object(raw), text, ocr_lines)
        except Exception as exc:  # noqa: BLE001 - whatever the model does, ask again
            last = exc
            logger.warning("Reading the reel's places failed (try %d): %s", attempt + 1, exc)
            await asyncio.sleep(2 * (attempt + 1))
    assert last is not None
    raise last
