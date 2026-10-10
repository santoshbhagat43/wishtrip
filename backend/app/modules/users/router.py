import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.core.pagination import Page
from app.db.session import get_session
from app.modules.audit.service import record
from app.modules.users import service
from app.modules.users.models import Role, User
from app.modules.users.schemas import UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/admin/users", tags=["users"])
admin_only = require_roles(Role.ADMIN)


@router.get("", response_model=Page[UserRead])
async def list_users(
    role: Role | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(admin_only),
):
    items, total = await service.list_users(session, role, page, page_size)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=UserRead, status_code=201)
async def create_user(
    data: UserCreate,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(admin_only),
):
    user = await service.create(session, data)
    await record(
        session, actor, "create", "user", user.id, {"email": user.email, "role": user.role}
    )
    await session.commit()
    return user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    session: AsyncSession = Depends(get_session),
    actor: User = Depends(admin_only),
):
    user = await service.get(session, user_id)
    await service.update(session, user, data)
    await record(
        session,
        actor,
        "update",
        "user",
        user.id,
        data.model_dump(exclude_unset=True, exclude={"password"}),
    )
    await session.commit()
    return user
