"""Import the client's knowledge base (client_work/knowledge_base) into WishTrip.

    docker compose exec backend python -m app.scripts.import_client_kb
    uv run python -m app.scripts.import_client_kb --path ../client_work/knowledge_base

Idempotent: rows are upserted on (source, external_id), so re-running after the client data
is re-normalized updates records in place. Hotels arrive as drafts (needs verification);
unverified prices stay in `reference` and never become a traveler-facing price.
"""

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm.attributes import set_committed_value

from app.ai.indexing import embed_locations
from app.ai.orchestrator import AIOrchestrator
from app.db.session import SessionLocal
from app.modules.knowledge.models import (
    Location,
    LocationRelation,
    LocationStatus,
    LocationType,
    RelationType,
    Tag,
    TagCategory,
)
from app.modules.knowledge.service import slugify

DEFAULT_PATH = os.environ.get("CLIENT_KB_PATH", "/client_work/knowledge_base")
TYPE_ORDER = {LocationType.COUNTRY: 0, LocationType.CITY: 1}
# Content we import and fingerprint, versioned: adding an imported field must not make every
# existing row look staff-edited, so each row records which field set its hash covers.
_V1_FIELDS = (
    "name",
    "status",
    "summary",
    "description",
    "latitude",
    "longitude",
    "address",
    "region",
    "highlight",
    "duration_minutes",
    "best_times",
    "seasons",
    "opening_hours",
    "cost_level",
    "energy_level",
    "difficulty",
    "family_friendly",
    "couple_friendly",
    "accessible",
    "tips",
)
FINGERPRINT_FIELDS = {1: _V1_FIELDS, 2: (*_V1_FIELDS, "aliases")}
FINGERPRINT_VERSION = max(FINGERPRINT_FIELDS)
CONTENT_FIELDS = FINGERPRINT_FIELDS[FINGERPRINT_VERSION]

FIELDS = (
    "name",
    "status",
    "summary",
    "description",
    "latitude",
    "longitude",
    "address",
    "region",
    "aliases",
    "highlight",
    "duration_minutes",
    "best_times",
    "seasons",
    "opening_hours",
    "cost_level",
    "energy_level",
    "difficulty",
    "family_friendly",
    "couple_friendly",
    "accessible",
    "tips",
)
FIELDS = (
    "name",
    "status",
    "summary",
    "description",
    "latitude",
    "longitude",
    "address",
    "region",
    "aliases",
    "highlight",
    "duration_minutes",
    "best_times",
    "seasons",
    "opening_hours",
    "cost_level",
    "energy_level",
    "difficulty",
    "family_friendly",
    "couple_friendly",
    "accessible",
    "tips",
    "provenance",
    "reference",
)
DIET_TAGS = {"Vegetarian", "Jain options"}


def fingerprint(
    values: dict,
    tag_slugs: list[str],
    parent_external_id: str | None,
    version: int = FINGERPRINT_VERSION,
) -> str:
    """Stable hash of a record's imported content, used to detect staff edits."""
    content = {f: values.get(f) for f in FINGERPRINT_FIELDS[version]}
    content["status"] = str(content["status"] or "draft")
    content["tags"] = sorted(tag_slugs)
    content["parent"] = parent_external_id
    return hashlib.sha256(json.dumps(content, sort_keys=True, default=str).encode()).hexdigest()


def _db_values(location: Location) -> dict:
    values = {f: getattr(location, f) for f in CONTENT_FIELDS}
    values["status"] = location.status.value if location.status else None
    return values


def _tag_category(name: str) -> TagCategory:
    if name in DIET_TAGS:
        return TagCategory.CUISINE
    return TagCategory.INTEREST


async def run(path: Path, embed: bool) -> None:
    locations = json.loads((path / "locations.json").read_text())
    relations = json.loads((path / "relations.json").read_text())
    locations.sort(key=lambda r: TYPE_ORDER.get(LocationType(r["type"]), 2))
    source = locations[0]["provenance"]["source"]

    async with SessionLocal() as session:
        tags = {t.name.lower(): t for t in await session.scalars(select(Tag))}
        tag_slugs = {t.slug for t in tags.values()}
        for name in sorted({n for r in locations for n in r.get("tags", [])}):
            if name.lower() not in tags and slugify(name) not in tag_slugs:
                tag = Tag(name=name, slug=slugify(name), category=_tag_category(name))
                session.add(tag)
                tags[name.lower()] = tag
                tag_slugs.add(tag.slug)
        await session.flush()
        tags_by_slug = {t.slug: t for t in tags.values()}

        existing = {
            loc.external_id: loc
            for loc in (
                await session.scalars(select(Location).where(Location.source == source))
            ).unique()
        }
        # Countries may already exist from manual entry; adopt them instead of duplicating.
        manual_countries = {
            loc.name.lower(): loc
            for loc in (
                await session.scalars(select(Location).where(Location.type == LocationType.COUNTRY))
            ).unique()
        }
        used_slugs = set(await session.scalars(select(Location.slug)))
        by_external: dict[str, Location] = {}
        external_of = {loc.id: ext for ext, loc in existing.items()}
        created = updated = kept = 0

        for row in locations:
            loc_type = LocationType(row["type"])
            location = existing.get(row["external_id"])
            if location is None and loc_type == LocationType.COUNTRY:
                location = manual_countries.get(row["name"].lower())
                if location is not None:
                    location.source, location.external_id = source, row["external_id"]
            if location is None:
                base = slugify(row["name"])
                slug, n = base, 2
                while slug in used_slugs:
                    slug, n = f"{base}-{n}", n + 1
                used_slugs.add(slug)
                # Initialise the tag collection so comparing it below never lazy-loads.
                location = Location(
                    type=loc_type, slug=slug, source=source, external_id=row["external_id"], tags=[]
                )
                session.add(location)
                created += 1
            else:
                # Staff edits win: if the row no longer matches what we last imported (or was
                # verified), leave it alone rather than silently reverting someone's work.
                previous = (location.provenance or {}).get("import_hash")
                version = (location.provenance or {}).get("import_hash_version", 1)
                current = fingerprint(
                    _db_values(location),
                    [t.slug for t in location.tags],
                    external_of.get(location.parent_id),
                    version,
                )
                verified = (location.provenance or {}).get("needs_verification") is False
                if verified or (previous and previous != current):
                    by_external[row["external_id"]] = location
                    kept += 1
                    continue
                updated += 1
            # Only write what differs: an unchanged row must not bump updated_at, or every
            # re-import would mark it stale and pay to re-embed it.
            for field in FIELDS:
                if field in ("provenance",):
                    continue
                if field in row and row[field] is not None or field == "status":
                    value = row.get(field)
                    if field == "status":
                        value = LocationStatus(value or "draft")
                    if getattr(location, field) != value:
                        setattr(location, field, value)
            parent_ext = row.get("parent_external_id")
            if parent_ext and location.parent_id != by_external[parent_ext].id:
                location.parent_id = by_external[parent_ext].id
            new_tags = [
                tags_by_slug[slugify(n)] for n in row.get("tags", []) if slugify(n) in tags_by_slug
            ]
            if {t.id for t in location.tags} != {t.id for t in new_tags}:
                location.tags = new_tags
            await session.flush()
            # Fingerprint what was actually stored (with defaults filled in), not the raw row.
            provenance = {
                **(row.get("provenance") or {}),
                "import_hash": fingerprint(
                    _db_values(location), [t.slug for t in location.tags], parent_ext
                ),
                "import_hash_version": FINGERPRINT_VERSION,
            }
            if location.provenance != provenance:
                # Bookkeeping, not an edit: keep updated_at so the row doesn't turn stale and
                # get re-embedded for nothing.
                await session.execute(
                    update(Location)
                    .where(Location.id == location.id)
                    .values(provenance=provenance, updated_at=Location.updated_at)
                )
                set_committed_value(location, "provenance", provenance)
            by_external[row["external_id"]] = location
            external_of[location.id] = row["external_id"]

        relation_count = 0
        for rel in relations:
            source_loc = by_external.get(rel["source_external_id"])
            target_loc = by_external.get(rel["target_external_id"])
            if not source_loc or not target_loc:
                continue
            relation = await session.scalar(
                select(LocationRelation).where(
                    LocationRelation.source_id == source_loc.id,
                    LocationRelation.target_id == target_loc.id,
                    LocationRelation.relation == RelationType(rel["relation"]),
                )
            )
            if relation is None:
                relation = LocationRelation(
                    source_id=source_loc.id,
                    target_id=target_loc.id,
                    relation=RelationType(rel["relation"]),
                )
                session.add(relation)
            relation.travel_minutes = rel.get("travel_minutes")
            relation.distance_meters = rel.get("distance_meters")
            relation.note = (rel.get("note") or "")[:500]
            relation_count += 1

        await session.commit()
        print(
            f"Imported {len(locations)} locations ({created} new, {updated} checked, "
            f"{kept} kept because staff edited or verified them), "
            f"{relation_count} routes, {len(tags)} tags."
        )
        if embed:
            ai = AIOrchestrator()
            count = await embed_locations(session, ai)
            print(f"Embedded {count} locations with {ai.embedder.name}.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", default=DEFAULT_PATH)
    parser.add_argument("--no-embed", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(Path(args.path), embed=not args.no_embed))


if __name__ == "__main__":
    main()
