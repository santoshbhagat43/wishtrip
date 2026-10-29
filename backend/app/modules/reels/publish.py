"""Staff add a reel's places that are not in our knowledge base yet, published straight away.

A new place carries only what the reel says: its name, its type and the town it is in, with the
creator's words as provenance and `needs_verification` set, so staff can find it and fill it in.
The reel is then matched again, so its places show as ours."""

import logging
import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import AIOrchestrator
from app.modules.chat.pipeline import resolve_destination
from app.modules.knowledge.models import Location, LocationStatus, LocationType
from app.modules.knowledge.service import _unique_slug
from app.modules.reels.models import CreatorContent
from app.modules.reels.understand import Reading

logger = logging.getLogger(__name__)

KIND_TYPE = {
    "sight": LocationType.ATTRACTION,
    "experience": LocationType.EXPERIENCE,
    "food": LocationType.RESTAURANT,
    "stay": LocationType.HOTEL,
}

# "South of Mauritius", "North-west coast of Goa": part of the destination, not a town.
_PART_OF = re.compile(r"^(north|south|east|west|central)(?:[\s-]?(?:east|west))?\b.*\bof\b", re.I)

TOWNS_PROMPT = """You place travel stops in towns. For each stop, give the town or village it is
in or nearest to, in the destination named. Prefer a town from the list; name another real town
only when none of them is close. Return JSON only: {"towns": {"<stop name>": "<town>"}}"""


def _is_town(place: dict[str, Any]) -> bool:
    return place.get("kind") == "area" and not _PART_OF.match(place.get("name") or "")


async def _container(
    session: AsyncSession, name: str, type_: LocationType, parent: Location | None, shortcode: str
) -> tuple[Location, bool]:
    """The country or city of that name, made (published) when we don't have it yet."""
    query = select(Location).where(
        Location.type == type_, func.lower(Location.name) == name.lower()
    )
    if parent is not None:
        query = query.where(Location.parent_id == parent.id)
    found = await session.scalar(query.limit(1))
    if found is not None:
        return found, False
    made = _new(name, type_, parent, shortcode, f"Named in the reel {shortcode}")
    made.slug = await _unique_slug(session, name)
    session.add(made)
    await session.flush()
    return made, True


def _new(
    name: str, type_: LocationType, parent: Location | None, shortcode: str, evidence: str
) -> Location:
    return Location(
        type=type_,
        status=LocationStatus.PUBLISHED,
        parent_id=parent.id if parent else None,
        name=name,
        source="reel",
        provenance={"reel": shortcode, "evidence": evidence, "needs_verification": True},
    )


async def _towns_for(
    ai: AIOrchestrator | None, destination: str, stops: list[str], towns: list[str]
) -> dict[str, str]:
    """Which town each stop is in: the town in its name when it has one, else the AI's answer."""
    out: dict[str, str] = {}
    for stop in stops:
        town = next((t for t in towns if re.search(rf"\b{re.escape(t)}\b", stop, re.I)), None)
        if town:
            out[stop] = town
    left = [s for s in stops if s not in out]
    if left and ai is not None and ai.supports("reader"):
        try:
            data = await ai.complete_json(
                "reader",
                [
                    {"role": "system", "content": TOWNS_PROMPT},
                    {
                        "role": "user",
                        "content": f"Destination: {destination}\nTowns: {', '.join(towns)}\n"
                        f"Stops:\n" + "\n".join(f"- {s}" for s in left),
                    },
                ],
                timeout=60,
            )
            for stop, town in (data.get("towns") or {}).items():
                if stop in left and str(town).strip():
                    out[stop] = str(town).strip()[:100]
        except Exception as exc:  # noqa: BLE001 - those stops then go in the first town
            logger.warning("Placing the reel's stops in towns failed: %s", exc)
    return out


async def add_to_places(
    session: AsyncSession, ai: AIOrchestrator | None, content: CreatorContent
) -> dict[str, Any]:
    """Publish the reel's places that are not ours yet. Returns what was added, what wasn't (and
    why), and the new rows' ids for embedding."""
    extracted = content.extracted or {}
    destination_name = content.destination_name or str(extracted.get("destination") or "")
    country_name = str(extracted.get("country") or "").strip()
    # Places added since the reel was read (from another reel, or by hand) count first.
    await _rematch(session, ai, content, destination_name, country_name)
    unknown = [p for p in content.places or [] if not p.get("verified")]
    added: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    new_ids: list[uuid.UUID] = []

    destination, _ = await resolve_destination(session, destination_name)
    if destination is not None and destination.type == LocationType.CITY:
        # A city trip ("Goa"): every stop goes in that city; its parts are not towns of their own.
        city_for: dict[str, Location] = {}
        stops = [p for p in unknown if p.get("kind") != "area"]
        skipped += [{"name": p["name"], "why": "a part of the city"} for p in unknown
                    if p.get("kind") == "area"]  # fmt: skip
        default_city = destination
    else:
        if destination is not None and destination.type == LocationType.COUNTRY:
            country = destination
        elif country_name or destination_name:
            country, made = await _container(
                session, country_name or destination_name, LocationType.COUNTRY, None,
                content.shortcode,
            )  # fmt: skip
            if made:
                new_ids.append(country.id)
                added.append({"name": country.name, "type": "country", "town": ""})
        else:
            why = [{"name": p["name"], "why": "no destination"} for p in unknown]
            return {"added": [], "skipped": why, "ids": []}
        towns = [p["name"] for p in unknown if _is_town(p)] + [
            p["location_name"] for p in content.places or []
            if p.get("verified") and p.get("location_type") == "city"
        ]  # fmt: skip
        skipped += [{"name": p["name"], "why": "a part of the country, not a town"}
                    for p in unknown if p.get("kind") == "area" and not _is_town(p)]  # fmt: skip
        stops = [p for p in unknown if p.get("kind") != "area"]
        placed = await _towns_for(ai, destination_name, [p["name"] for p in stops], towns)
        city_for = {}
        for town in dict.fromkeys([*towns, *placed.values()]):
            city, made = await _container(
                session, town, LocationType.CITY, country, content.shortcode
            )
            city_for[town.lower()] = city
            if made:
                new_ids.append(city.id)
                added.append({"name": city.name, "type": "city", "town": country.name})
        city_for = {
            stop: city_for[town.lower()]
            for stop, town in placed.items()
            if town.lower() in city_for
        }
        default_city = next(iter(city_for.values()), None)

    for place in stops:
        city = city_for.get(place["name"]) or default_city
        if city is None:
            skipped.append({"name": place["name"], "why": "no town to put it in"})
            continue
        type_ = KIND_TYPE.get(place.get("kind") or "", LocationType.ATTRACTION)
        # Already ours under a near-identical name anywhere in the trip ("Casela Nature Parks").
        from app.modules.reels.service import _same_place

        if any(_same_place(place["name"], name) for name in await _stop_names(session, city)):
            skipped.append({"name": place["name"], "why": "already in our places"})
            continue
        location = _new(place["name"], type_, city, content.shortcode, place.get("evidence") or "")
        location.slug = await _unique_slug(session, place["name"])
        session.add(location)
        await session.flush()
        new_ids.append(location.id)
        added.append({"name": location.name, "type": type_.value, "town": city.name})

    # Match the reel again so its places now show as ours.
    await _rematch(session, ai, content, destination_name, country_name)
    return {"added": added, "skipped": skipped, "ids": [str(i) for i in new_ids]}


async def _stop_names(session: AsyncSession, city: Location) -> list[str]:
    """The names of every stop in the city's country (or the city, when it has no country)."""
    cities = (
        select(Location.id).where(Location.parent_id == city.parent_id)
        if city.parent_id
        else select(Location.id).where(Location.id == city.id)
    )
    return list(await session.scalars(select(Location.name).where(Location.parent_id.in_(cities))))


async def _rematch(
    session: AsyncSession,
    ai: AIOrchestrator | None,
    content: CreatorContent,
    destination_name: str,
    country_name: str,
) -> None:
    from app.modules.reels.service import match_places

    reading = Reading(
        destination=destination_name,
        country=country_name,
        places=[{k: v for k, v in p.items() if k not in
                 ("verified", "location_id", "location_name", "location_type")}
                for p in content.places or []],
    )  # fmt: skip
    matched_to, content.places = await match_places(session, ai or AIOrchestrator(), reading)
    if matched_to is not None:
        content.destination_id = matched_to.id
