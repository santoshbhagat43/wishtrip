"""Turn what a reel says (voice) and shows (caption + text on screen) into places."""

import base64
import re
from dataclasses import dataclass, field
from typing import Any

from app.ai.orchestrator import AIOrchestrator, parse_json_object

TRANSCRIBE_PROMPT = """Transcribe the speech in this audio from a short travel video.
Return JSON only:
{"language": "<ISO 639-1 code of the speech, or empty>",
 "transcript": "<the speech verbatim, in its original language>",
 "english": "<an English translation; repeat the transcript if it is already English>",
 "music_only": <true when there is no speech, only music or noise>}
Do not describe the music. Do not add anything that is not said."""

EXTRACT_PROMPT = """You read travel reels. From the caption, the text shown on screen and the
voice-over below, list the real places the reel shows or recommends.

Rules:
- Only places that are named in the material. Never add places from your own knowledge.
- "evidence" must quote the words from the material that name the place (copy them exactly).
- "source" is where the evidence is: "caption", "screen" or "voice".
- "t" is the second in the video for screen/voice evidence when known, else null.
- kind is one of: "stay" (hotel, villa, homestay), "food" (restaurant, cafe, bar, dish spot),
  "sight" (beach, fort, church, viewpoint, market), "experience" (cruise, tour, activity),
  "area" (a town or neighbourhood).
- Prices, phone numbers and discount codes are not places. Ignore them.
- tips: short practical advice the creator gives (best time, what to avoid), in English.

Return JSON only:
{"destination": "<city or region the reel is about, or empty>",
 "country": "<country or empty>",
 "summary": "<one sentence on what the reel is about>",
 "days_hint": <number of days the creator suggests, or null>,
 "places": [{"name": "...", "kind": "...", "evidence": "...", "source": "...", "t": null}],
 "tips": ["..."]}"""

KINDS = {"stay", "food", "sight", "experience", "area"}
SOURCES = {"caption", "screen", "voice"}


@dataclass
class Transcript:
    text: str = ""
    language: str = ""
    english: str = ""


@dataclass
class Reading:
    destination: str = ""
    country: str = ""
    summary: str = ""
    days_hint: int | None = None
    places: list[dict[str, Any]] = field(default_factory=list)
    tips: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "destination": self.destination,
            "country": self.country,
            "summary": self.summary,
            "days_hint": self.days_hint,
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
    )


def material(caption: str, hashtags: list[str], location: str, ocr_lines: list[dict],
             transcript: Transcript) -> str:  # fmt: skip
    parts = [f"CAPTION:\n{caption.strip() or '(none)'}"]
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


def grounded(place: dict[str, Any], corpus: str) -> bool:
    """The place must really be in the material: its evidence or a word of its name."""
    evidence = _norm(str(place.get("evidence") or ""))
    if evidence and evidence in corpus:
        return True
    words = [w for w in _norm(str(place.get("name") or "")).split() if len(w) >= 4]
    return any(re.search(rf"\b{re.escape(w)}\b", corpus) for w in words)


def clean_reading(data: dict[str, Any], text: str) -> Reading:
    corpus = _norm(text)
    places: list[dict[str, Any]] = []
    seen: set[str] = set()
    for p in data.get("places") or []:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()[:200]
        if name.isupper():  # on-screen captions are often in capitals
            name = name.title()
        if not name or _norm(name) in seen or not grounded(p, corpus):
            continue
        seen.add(_norm(name))
        t = p.get("t")
        places.append(
            {
                "name": name,
                "kind": p.get("kind") if p.get("kind") in KINDS else "sight",
                "evidence": str(p.get("evidence") or "").strip()[:300],
                "source": p.get("source") if p.get("source") in SOURCES else "caption",
                "t": float(t) if isinstance(t, int | float) else None,
            }
        )
    days = data.get("days_hint")
    return Reading(
        destination=str(data.get("destination") or "").strip()[:120],
        country=str(data.get("country") or "").strip()[:120],
        summary=str(data.get("summary") or "").strip()[:400],
        days_hint=days if isinstance(days, int) and 0 < days <= 30 else None,
        places=places[:20],
        tips=[str(t).strip()[:200] for t in (data.get("tips") or []) if str(t).strip()][:8],
    )


async def read_places(ai: AIOrchestrator, text: str) -> Reading:
    raw = await ai.complete(
        "planner",
        [{"role": "system", "content": EXTRACT_PROMPT}, {"role": "user", "content": text}],
        json_mode=True,
        temperature=0.1,
        max_tokens=2000,
    )
    return clean_reading(parse_json_object(raw), text)
