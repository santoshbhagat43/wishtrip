"""Whose creator workspace a request works in: the signed-in creator's own, or, for staff who
send X-Act-As-Creator, the creator they are working for (adding reels on their behalf)."""

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.errors import bad_request, not_found
from app.db.session import get_session
from app.modules.audit import service as audit
from app.modules.creators import trips
from app.modules.creators.models import Creator
from app.modules.users.models import Role, User

ACT_AS_HEADER = "x-act-as-creator"


@dataclass
class Acting:
    creator: Creator
    # The account the work is done under: the creator's own, whoever is at the keyboard.
    user: User
    # Set when staff are working for the creator.
    staff: User | None = None


async def acting_as(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Acting:
    wanted = request.headers.get(ACT_AS_HEADER)
    if not wanted:
        return Acting(await trips.require_creator(session, user.id), user)

    if user.role not in (Role.ADMIN, Role.EDITOR):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only staff can work for a creator.")
    try:
        creator = await session.get(Creator, uuid.UUID(wanted))
    except ValueError:
        creator = None
    if creator is None:
        raise not_found("Creator")
    owner = await session.get(User, creator.user_id) if creator.user_id else None
    if owner is None:
        # Their trips are kept under their account, which exists once they have signed in.
        raise bad_request(
            "This creator hasn't signed in yet, so there is no account to add reels to."
        )
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        await audit.record(
            session,
            user,
            "act_as",
            "creator",
            creator.id,
            {"method": request.method, "path": request.url.path},
        )
    return Acting(creator, owner, staff=user)
