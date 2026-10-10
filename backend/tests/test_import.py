import json

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.modules.knowledge.models import Location, LocationRelation
from app.scripts.import_client_kb import run

SRC = "test-kb"


def kb(tmp_path, summary="Riverside fort"):
    locations = [
        {
            "external_id": f"{SRC}:country:in",
            "type": "country",
            "name": "Testland",
            "status": "published",
            "tags": [],
            "provenance": {"source": SRC},
        },
        {
            "external_id": f"{SRC}:city:a",
            "type": "city",
            "name": "Alpha",
            "status": "published",
            "parent_external_id": f"{SRC}:country:in",
            "region": "Northern",
            "tags": [],
            "provenance": {"source": SRC},
        },
        {
            "external_id": f"{SRC}:city:b",
            "type": "city",
            "name": "Beta",
            "status": "published",
            "parent_external_id": f"{SRC}:country:in",
            "region": "Northern",
            "tags": [],
            "provenance": {"source": SRC},
        },
        {
            "external_id": f"{SRC}:exp:fort",
            "type": "attraction",
            "name": "Old Fort",
            "status": "published",
            "parent_external_id": f"{SRC}:city:a",
            "summary": summary,
            "best_times": ["morning"],
            "tags": ["History", "Scenic views"],
            "provenance": {"source": SRC},
            "reference": {"ticket_price_per_person_inr_unverified": 300},
        },
        {
            "external_id": f"{SRC}:stay:inn",
            "type": "hotel",
            "name": "Test Inn",
            "status": "draft",
            "parent_external_id": f"{SRC}:city:a",
            "tags": [],
            "provenance": {"source": SRC, "needs_verification": True},
            "reference": {"rate_per_night_inr_unverified": 5000},
        },
    ]
    relations = [
        {
            "source_external_id": f"{SRC}:city:a",
            "target_external_id": f"{SRC}:city:b",
            "relation": "route_to",
            "travel_minutes": 90,
            "note": "drive",
        }
    ]
    (tmp_path / "locations.json").write_text(json.dumps(locations))
    (tmp_path / "relations.json").write_text(json.dumps(relations))
    return tmp_path


async def by_ext(ext: str) -> Location:
    async with SessionLocal() as session:
        return await session.scalar(select(Location).where(Location.external_id == ext))


async def test_import_creates_everything_and_is_idempotent(tmp_path, capsys):
    path = kb(tmp_path)
    await run(path, embed=False)
    assert "5 new" in capsys.readouterr().out
    fort = await by_ext(f"{SRC}:exp:fort")
    assert fort.status.value == "published"
    assert {t.name for t in fort.tags} == {"History", "Scenic views"}
    assert fort.price_note == ""  # unverified prices never become traveler-facing
    assert fort.reference["ticket_price_per_person_inr_unverified"] == 300
    assert "import_hash" in fort.provenance

    async with SessionLocal() as session:
        before = {
            loc.external_id: loc.updated_at
            for loc in (
                await session.scalars(select(Location).where(Location.source == SRC))
            ).unique()
        }
    await run(path, embed=False)
    assert "0 new, 5 checked, 0 kept" in capsys.readouterr().out
    async with SessionLocal() as session:
        after = {
            loc.external_id: loc.updated_at
            for loc in (
                await session.scalars(select(Location).where(Location.source == SRC))
            ).unique()
        }
        # A no-op re-import writes nothing, so nothing becomes stale for re-embedding.
        assert after == before
        assert await session.scalar(select(func.count()).where(Location.source == SRC)) == 5
        assert await session.scalar(select(func.count()).select_from(LocationRelation)) == 1


async def test_reimport_applies_new_client_data_to_untouched_rows(tmp_path, capsys):
    await run(kb(tmp_path), embed=False)
    await run(kb(tmp_path, summary="Restored riverside fort and gallery"), embed=False)
    assert (await by_ext(f"{SRC}:exp:fort")).summary == "Restored riverside fort and gallery"


async def test_reimport_never_overwrites_staff_edits_or_verification(tmp_path, capsys):
    path = kb(tmp_path)
    await run(path, embed=False)
    async with SessionLocal() as session:
        fort = await session.scalar(
            select(Location).where(Location.external_id == f"{SRC}:exp:fort")
        )
        fort.duration_minutes = 120  # staff filled in a missing fact
        inn = await session.scalar(
            select(Location).where(Location.external_id == f"{SRC}:stay:inn")
        )
        inn.status = "published"
        inn.provenance = {
            **inn.provenance,
            "needs_verification": False,
            "verified_at": "2026-10-10",
        }
        await session.commit()
    capsys.readouterr()

    await run(kb(tmp_path, summary="Client changed this"), embed=False)
    assert "2 kept" in capsys.readouterr().out
    fort = await by_ext(f"{SRC}:exp:fort")
    assert fort.duration_minutes == 120
    assert fort.summary == "Riverside fort"
    inn = await by_ext(f"{SRC}:stay:inn")
    assert inn.status.value == "published"
    assert inn.provenance["needs_verification"] is False


async def test_fingerprint_upgrade_is_not_an_edit(tmp_path, capsys):
    """Rows hashed by an older importer (fewer fields) are upgraded without looking
    staff-edited and without bumping updated_at (which would force re-embedding)."""
    path = kb(tmp_path)
    await run(path, embed=False)
    async with SessionLocal() as session:
        for loc in (await session.scalars(select(Location).where(Location.source == SRC))).unique():
            from app.scripts.import_client_kb import _db_values, fingerprint

            provenance = {k: v for k, v in loc.provenance.items() if k != "import_hash_version"}
            parent = None if loc.parent is None else loc.parent.external_id
            provenance["import_hash"] = fingerprint(
                _db_values(loc), [t.slug for t in loc.tags], parent, version=1
            )
            loc.provenance = provenance
        await session.commit()
        before = {
            loc.external_id: loc.updated_at
            for loc in (
                await session.scalars(select(Location).where(Location.source == SRC))
            ).unique()
        }
    capsys.readouterr()
    await run(path, embed=False)
    assert "0 kept" in capsys.readouterr().out
    async with SessionLocal() as session:
        rows = (await session.scalars(select(Location).where(Location.source == SRC))).unique()
        assert {loc.external_id: loc.updated_at for loc in rows} == before
        fort = await session.scalar(
            select(Location).where(Location.external_id == f"{SRC}:exp:fort")
        )
        assert fort.provenance["import_hash_version"] == 2
