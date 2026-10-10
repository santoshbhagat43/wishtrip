import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.core.pagination import Page
from app.db.session import get_session
from app.modules.audit.models import AuditLog
from app.modules.users.models import Role, User

router = APIRouter(prefix="/admin/audit-log", tags=["audit"])


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_email: str
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    changes: dict
    created_at: datetime


@router.get("", response_model=Page[AuditLogRead])
async def list_audit_log(
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_roles(Role.ADMIN, Role.EDITOR)),
):
    query = select(AuditLog)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.where(AuditLog.entity_id == entity_id)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(
        query.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    return Page(items=list(rows), total=total, page=page, page_size=page_size)
