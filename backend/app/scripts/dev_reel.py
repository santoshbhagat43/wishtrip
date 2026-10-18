"""Put an already-read reel in the cache, so a reel link can build an itinerary without Instagram.

A fixture for browser tests and local demos; the real reading is `app.modules.reels`:

    python -m app.scripts.dev_reel <shortcode>
"""

import asyncio
import io
import sys

from PIL import Image, ImageDraw

from app.db.session import SessionLocal
from app.modules.media.storage import storage
from app.modules.reels import service
from app.modules.reels.models import CreatorContent

PLACES = [
    ("Fort Aguada", "sight", "sunset at fort aguada", 4),
    ("Anjuna fish thali", "food", "best fish thali in anjuna", 9),
    ("Morjim beach", "experience", "a slow walk on morjim beach", 15),
    ("Mandovi sunset cruise", "experience", "take the mandovi sunset cruise", 21),
    ("Fontainhas", "sight", "wander through fontainhas", 24),
    ("Old Goa churches", "sight", "the churches of old goa", 31),
]


def cover() -> bytes:
    """A stand-in cover picture: a sunset gradient, as tall as a reel."""
    image = Image.new("RGB", (540, 960))
    draw = ImageDraw.Draw(image)
    for y in range(960):
        f = y / 959
        draw.line(
            [(0, y), (540, y)], fill=(int(250 - 120 * f), int(150 - 90 * f), int(90 + 60 * f))
        )
    out = io.BytesIO()
    image.save(out, "JPEG")
    return out.getvalue()


async def main(shortcode: str) -> None:
    async with SessionLocal() as session:
        if await service.cached(session, shortcode):
            return
        session.add(
            CreatorContent(
                shortcode=shortcode,
                url=service.canonical_url(shortcode),
                caption="A slow weekend in Goa",
                thumbnail_key=storage.save(cover(), "cover.jpg", "reels"),
                destination_name="Goa",
                extracted={"summary": "A slow Goa weekend.", "days_hint": 2, "tips": []},
                places=[
                    {
                        "name": name,
                        "kind": kind,
                        "evidence": evidence,
                        "source": "voice",
                        "t": t,
                        "verified": False,
                        "location_id": None,
                        "location_name": None,
                    }
                    for name, kind, evidence, t in PLACES
                ],
            )
        )
        await session.commit()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
