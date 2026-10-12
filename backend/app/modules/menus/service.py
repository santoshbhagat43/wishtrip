import re
import unicodedata
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import bad_request, not_found
from app.modules.knowledge.models import Location, LocationStatus, LocationType
from app.modules.menus.models import MenuGroup, MenuItem, MenuPlacement
from app.modules.menus.schemas import (
    MenuGroupCreate,
    MenuGroupRead,
    MenuGroupUpdate,
    MenuItemCreate,
    MenuItemRead,
    MenuItemUpdate,
    PublicMenu,
    PublicMenuItem,
)


def slugify(value: str) -> str:
    cleaned = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", cleaned.lower()).strip("-") or "menu"


def _place_url(location: Location) -> str:
    """Where a linked place lives on the traveler site."""
    return (
        f"/explore/{location.id}"
        if location.type in (LocationType.CITY, LocationType.COUNTRY)
        else f"/places/{location.id}"
    )


def _to_item(item: MenuItem) -> MenuItemRead:
    read = MenuItemRead.model_validate(item)
    read.resolved_url = _place_url(item.location) if item.location else item.url
    read.location_name = item.location.name if item.location else None
    return read


def _to_group(group: MenuGroup) -> MenuGroupRead:
    return MenuGroupRead(
        id=group.id,
        name=group.name,
        slug=group.slug,
        placement=group.placement,
        position=group.position,
        is_active=group.is_active,
        items=[_to_item(i) for i in sorted(group.items, key=lambda i: (i.position, i.label))],
    )


async def _reload(session: AsyncSession, group_id: uuid.UUID) -> MenuGroupRead:
    group = await session.get(
        MenuGroup,
        group_id,
        options=[selectinload(MenuGroup.items).joinedload(MenuItem.location)],
        populate_existing=True,
    )
    return _to_group(group)


async def list_groups(session: AsyncSession) -> list[MenuGroupRead]:
    groups = await session.scalars(
        select(MenuGroup)
        .options(selectinload(MenuGroup.items).joinedload(MenuItem.location))
        .order_by(MenuGroup.placement, MenuGroup.position, MenuGroup.name)
    )
    return [_to_group(g) for g in groups.unique()]


async def create_group(session: AsyncSession, data: MenuGroupCreate) -> MenuGroupRead:
    slug = slugify(data.name)
    if await session.scalar(select(MenuGroup.id).where(MenuGroup.slug == slug)):
        raise bad_request(f"A menu called “{data.name}” already exists")
    position = data.position
    if position is None:
        last = await session.scalar(
            select(func.max(MenuGroup.position)).where(MenuGroup.placement == data.placement)
        )
        position = (last or 0) + 1
    group = MenuGroup(
        name=data.name,
        slug=slug,
        placement=data.placement,
        position=position,
        is_active=data.is_active,
    )
    session.add(group)
    await session.commit()
    return await _reload(session, group.id)


async def update_group(
    session: AsyncSession, group_id: uuid.UUID, data: MenuGroupUpdate
) -> MenuGroupRead:
    group = await session.get(MenuGroup, group_id)
    if not group:
        raise not_found("Menu not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    if data.name:
        group.slug = slugify(data.name)
    await session.commit()
    return await _reload(session, group.id)


async def delete_group(session: AsyncSession, group_id: uuid.UUID) -> None:
    group = await session.get(MenuGroup, group_id)
    if not group:
        raise not_found("Menu not found")
    await session.delete(group)
    await session.commit()


async def add_item(
    session: AsyncSession, group_id: uuid.UUID, data: MenuItemCreate
) -> MenuGroupRead:
    group = await session.get(
        MenuGroup, group_id, options=[selectinload(MenuGroup.items)], populate_existing=True
    )
    if not group:
        raise not_found("Menu not found")
    if not data.url and not data.location_id:
        raise bad_request("A link needs either a URL or a place to point at")
    if data.location_id:
        place = await session.get(Location, data.location_id)
        if not place:
            raise bad_request("That place does not exist")
        if place.status != LocationStatus.PUBLISHED:
            raise bad_request(f"“{place.name}” is not published, so travelers could not open it")
    position = data.position
    if position is None:
        position = max((i.position for i in group.items), default=0) + 1
    session.add(
        MenuItem(
            group_id=group.id,
            label=data.label,
            url=data.url,
            location_id=data.location_id,
            position=position,
            is_active=data.is_active,
            opens_in_new_tab=data.opens_in_new_tab,
        )
    )
    await session.commit()
    return await _reload(session, group.id)


async def update_item(
    session: AsyncSession, item_id: uuid.UUID, data: MenuItemUpdate
) -> MenuGroupRead:
    item = await session.get(MenuItem, item_id)
    if not item:
        raise not_found("Link not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await session.commit()
    return await _reload(session, item.group_id)


async def delete_item(session: AsyncSession, item_id: uuid.UUID) -> None:
    item = await session.get(MenuItem, item_id)
    if not item:
        raise not_found("Link not found")
    await session.delete(item)
    await session.commit()


async def public_menus(
    session: AsyncSession, placement: MenuPlacement | None = None
) -> list[PublicMenu]:
    """What the traveler website renders. Inactive menus and links are simply absent."""
    query = (
        select(MenuGroup)
        .options(selectinload(MenuGroup.items).joinedload(MenuItem.location))
        .where(MenuGroup.is_active.is_(True))
    )
    if placement:
        query = query.where(MenuGroup.placement == placement)
    groups = (
        await session.scalars(query.order_by(MenuGroup.placement, MenuGroup.position))
    ).unique()
    return [
        PublicMenu(
            name=g.name,
            slug=g.slug,
            placement=g.placement,
            items=[
                PublicMenuItem(
                    label=i.label,
                    url=_place_url(i.location) if i.location else i.url,
                    opens_in_new_tab=i.opens_in_new_tab,
                )
                for i in sorted(g.items, key=lambda i: (i.position, i.label))
                # A link to a place that was unpublished since would 404; drop it instead.
                if i.is_active and (not i.location or i.location.status == LocationStatus.PUBLISHED)
            ],
        )
        for g in groups
    ]
