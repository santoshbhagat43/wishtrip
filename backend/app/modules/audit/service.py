import uuid
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog
from app.modules.users.models import User


async def record(
    session: AsyncSession,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    changes: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            user_id=actor.id,
            user_email=actor.email,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            changes=jsonable_encoder(changes or {}),
        )
    )
