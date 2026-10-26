"""Is this stay in the reel that TripJack hotel? Name matching, with a score.

A reel names a hotel the way people write: "Grand Mega Resort & Spa or similar", "Alila Seminyak -
5 nights", "stay at the Mulia (5 star)". `clean_name` strips that noise; `score` compares the
distinctive words (the hotel's own name, not "hotel", "resort" or "spa") allowing small typos.

  score >= CONFIDENT  the photo is shown
  score >= REVIEW     a likely match, shown to staff to confirm, never to travellers
"""

import re
import unicodedata
from difflib import SequenceMatcher

CONFIDENT = 0.85
REVIEW = 0.55

# Words that say "this is a hotel" rather than which one. They count a little, not a lot.
WEAK = {
    "hotel", "hotels", "resort", "resorts", "spa", "villa", "villas", "inn", "suites", "suite",
    "boutique", "homestay", "guest", "house", "lodge", "restaurant", "club", "hostel", "residence",
    "apartment", "apartments", "cottage", "cottages", "retreat", "bungalow", "bungalows", "beach",
    "bay", "stay", "stays", "lodging", "motel", "camp",
}
# Not a word of the name at all.
DROPPED = {"the", "a", "an", "of", "at", "in", "by", "and", "or", "to", "for", "with", "near"}
WEAK_WEIGHT = 0.3

_NOISE = [
    # A lead-in comes off first ("Check in · X", "Stay at X"), then what trails the name.
    re.compile(
        r"^(?:check[\s-]?in|checking in|stay(?:ing)?|overnight|accommodation)"
        r"\s*(?:at|in|[:·-])\s+",
        re.I,
    ),
    re.compile(r"\bor\s+(?:a\s+)?(?:similar|equivalent|alternative)\b.*", re.I),
    re.compile(r"[(\[].*?[)\]]"),
    re.compile(r"\s[-–—|:·]\s.*$"),
    re.compile(r"\b\d+\s*(?:nights?|days?|n|d)\b.*", re.I),
    re.compile(r"\b[1-5][\s-]*(?:stars?|\*)", re.I),
]
_TRAILING_PLACE = re.compile(r"\s+(?:in|near)\s+\S+(?:\s+\S+)?$", re.I)


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def clean_name(name: str) -> str:
    """The stay's name without the words around it ("or similar", "- 5 nights", "(4-star)")."""
    text = strip_accents(name or "").strip()
    for pattern in _NOISE:
        text = pattern.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip(" ,.-–—")
    trimmed = _TRAILING_PLACE.sub("", text)
    if len(re.findall(r"\w+", trimmed)) >= 2:  # "The Mulia in Nusa Dua", not "Hotel in Kuta"
        text = trimmed
    return text


def words(name: str) -> list[str]:
    spelled = strip_accents(name or "").lower().replace("&", " and ")
    return [w for w in re.findall(r"[a-z0-9]+", spelled) if w not in DROPPED]


def _weight(word: str, weak: set[str]) -> float:
    return WEAK_WEIGHT if word in WEAK or word in weak else 1.0


def _similar(a: str, b: str) -> float:
    """1 for the same word; a little less for a close one (a typo, a plural); else 0."""
    if a == b:
        return 1.0
    if max(len(a), len(b)) < 5:
        return 0.0
    ratio = SequenceMatcher(None, a, b).ratio()
    return ratio if ratio >= 0.8 else 0.0


def score(stop_name: str, hotel_name: str, place: str = "", area: str = "") -> float:
    """0..1: how sure we are that the stay is this hotel. `place` is the trip's destination (its
    words count as weak, like "bali" in "Grand Mega Resort Bali"); `area` is where the hotel
    is (city, address), which nudges a hotel in the right place a little higher."""
    weak = set(words(place))
    want, have = words(clean_name(stop_name)), words(hotel_name)
    strong_want = [w for w in want if _weight(w, weak) == 1.0]
    if not strong_want or not have:
        return 0.0
    free = list(have)
    matched = 0.0
    strong_hits = 0
    for w in want:
        best, at = 0.0, -1
        for i, h in enumerate(free):
            s = _similar(w, h)
            if s > best:
                best, at = s, i
        if at >= 0:
            weight = _weight(w, weak)
            # A near-miss counts for much less than the same word, so "Space" does not pass for
            # "Spaces" when the real hotel is also there.
            matched += weight * (best if best == 1.0 else best**3)
            strong_hits += weight == 1.0 and best >= 0.8
            free.pop(at)
    total = sum(_weight(w, weak) for w in want) + sum(_weight(w, weak) for w in have)
    value = 2 * matched / total
    # Every distinctive word of the stay is in the hotel's name: it may carry more (a brand, a
    # place) and still be the same hotel, as long as the stay named at least two words.
    if len(strong_want) >= 2 and strong_hits == len(strong_want):
        extra = sum(1 for h in free if _weight(h, weak) == 1.0)
        value = max(value, 0.92 - 0.06 * min(extra, 4))
    if area and value >= REVIEW:
        here = set(words(area))
        if here & (weak | {w for w in want}):
            value += 0.03
    return round(min(value, 1.0), 3)
