"""Seed the B4 website's header, footer and drawer menus. Safe to run repeatedly.

Each group is keyed by slug and created only if missing, so staff edits in the dashboard
(Menus) are never overwritten. The B4 header/footer render these by slug.
"""

import asyncio

from sqlalchemy import select

import app.db.models  # noqa: F401  -- register every mapper (MenuItem -> Location)
from app.db.session import SessionLocal
from app.modules.menus.models import MenuGroup, MenuItem, MenuPlacement

# slug -> (name, placement, [(label, url)])
GROUPS: list[tuple[str, str, MenuPlacement, list[tuple[str, str]]]] = [
    (
        "b4-primary",
        "Main navigation",
        MenuPlacement.HEADER,
        [
            ("How it works", "/#b4-arya"),
            ("Destinations", "/destinations"),
            ("Creator trips", "/creators/trips"),
            ("For creators", "/creators"),
        ],
    ),
    (
        "b4-footer-explore",
        "Explore",
        MenuPlacement.FOOTER,
        [
            ("Destinations", "/destinations"),
            ("Creator trips", "/creators/trips"),
            ("Plan a trip", "/arya"),
            ("Reel to trip", "/reel"),
        ],
    ),
    (
        "b4-footer-company",
        "wishtrip",
        MenuPlacement.FOOTER,
        [
            ("For creators", "/creators"),
            ("Sign in", "/login"),
            ("Help", "/help"),
            ("Explore", "/explore"),
        ],
    ),
    (
        "b4-drawer",
        "Menu",
        MenuPlacement.MOBILE,
        [
            ("Start planning", "/arya"),
            ("Turn a reel into a trip", "/reel"),
            ("Destinations", "/destinations"),
            ("Creator trips", "/creators/trips"),
            ("For creators", "/creators"),
        ],
    ),
]


async def main() -> None:
    async with SessionLocal() as session:
        created = 0
        for position, (slug, name, placement, items) in enumerate(GROUPS, start=10):
            exists = await session.scalar(select(MenuGroup).where(MenuGroup.slug == slug))
            if exists:
                print(f"Skipped {slug} (already present).")
                continue
            group = MenuGroup(name=name, slug=slug, placement=placement, position=position)
            session.add(group)
            await session.flush()
            for i, (label, url) in enumerate(items):
                session.add(MenuItem(group_id=group.id, label=label, url=url, position=i))
            created += 1
            print(f"Created {slug} with {len(items)} links.")
        await session.commit()
        print(f"Done. {created} new B4 menu group(s).")


if __name__ == "__main__":
    asyncio.run(main())
