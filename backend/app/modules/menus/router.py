import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_staff
from app.db.session import get_session
from app.modules.audit.service import record
from app.modules.menus import service
from app.modules.menus.models import MenuPlacement
from app.modules.menus.schemas import (
    MenuGroupCreate,
    MenuGroupRead,
    MenuGroupUpdate,
    MenuItemCreate,
    MenuItemUpdate,
    PublicMenu,
)
from app.modules.users.models import User

router = APIRouter(tags=["menus"])


@router.get("/admin/menus", response_model=list[MenuGroupRead])
async def list_menus(
    session: AsyncSession = Depends(get_session), _: User = Depends(require_staff)
):
    """Every menu on the traveler site, with its links in display order."""
    return await service.list_groups(session)


@router.post("/admin/menus", response_model=MenuGroupRead, status_code=201)
async def create_menu(
    data: MenuGroupCreate,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_staff),
):
    group = await service.create_group(session, data)
    await record(session, staff, "create", "menu_group", group.id, {"name": group.name})
    await session.commit()
    return group


@router.patch("/admin/menus/{group_id}", response_model=MenuGroupRead)
async def change_menu(
    group_id: uuid.UUID,
    data: MenuGroupUpdate,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_staff),
):
    group = await service.update_group(session, group_id, data)
    await record(
        session, staff, "update", "menu_group", group_id, data.model_dump(exclude_unset=True)
    )
    await session.commit()
    return group


@router.delete("/admin/menus/{group_id}", status_code=204)
async def remove_menu(
    group_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_staff),
):
    await service.delete_group(session, group_id)
    await record(session, staff, "delete", "menu_group", group_id, {})
    await session.commit()
    return Response(status_code=204)


@router.post("/admin/menus/{group_id}/items", response_model=MenuGroupRead, status_code=201)
async def add_link(
    group_id: uuid.UUID,
    data: MenuItemCreate,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_staff),
):
    group = await service.add_item(session, group_id, data)
    await record(session, staff, "create", "menu_item", group_id, {"label": data.label})
    await session.commit()
    return group


@router.patch("/admin/menu-items/{item_id}", response_model=MenuGroupRead)
async def change_link(
    item_id: uuid.UUID,
    data: MenuItemUpdate,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_staff),
):
    group = await service.update_item(session, item_id, data)
    await record(
        session, staff, "update", "menu_item", item_id, data.model_dump(exclude_unset=True)
    )
    await session.commit()
    return group


@router.delete("/admin/menu-items/{item_id}", status_code=204)
async def remove_link(
    item_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    staff: User = Depends(require_staff),
):
    await service.delete_item(session, item_id)
    await record(session, staff, "delete", "menu_item", item_id, {})
    await session.commit()
    return Response(status_code=204)


@router.get("/explore/menus", response_model=list[PublicMenu])
async def public_menus(
    placement: MenuPlacement | None = None, session: AsyncSession = Depends(get_session)
):
    """Navigation for the traveler website: active menus, active links, published places only."""
    return await service.public_menus(session, placement)
