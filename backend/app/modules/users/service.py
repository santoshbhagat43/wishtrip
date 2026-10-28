import secrets
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import conflict, not_found
from app.core.security import hash_password
from app.modules.users.models import Role, User
from app.modules.users.schemas import UserCreate, UserUpdate


async def get_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(func.lower(User.email) == email.lower()))


async def get(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if not user:
        raise not_found("User")
    return user


async def create(session: AsyncSession, data: UserCreate) -> User:
    if await get_by_email(session, data.email):
        raise conflict("Email already registered")
    user = User(
        email=data.email.lower(),
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        role=data.role,
    )
    session.add(user)
    await session.flush()
    return user


async def get_or_create_passwordless_user(
    session: AsyncSession, email: str, full_name: str = ""
) -> tuple[User, bool]:
    """Find the user who owns this email, or create a traveler for them.

    Used by Google sign-in and by emailed one-time codes, which have no password. Returns the
    user and whether they were just created (a new sign-up, which a creator's referral link may be
    credited for). We store a random hash to keep the password column non-guessable. The caller
    commits.
    """
    from app.modules.creators.models import Creator  # local: creators imports users

    user = await get_by_email(session, email)
    if user:
        if user.role == Role.TRAVELER:
            # A traveller who applied as a creator before accounts were linked signs in as one.
            creator = await session.scalar(
                select(Creator).where(
                    func.lower(Creator.email) == email.lower(), Creator.user_id.is_(None)
                )
            )
            if creator:
                user.role = Role.CREATOR
                creator.user_id = user.id
        return user, False
    # Someone who applied as a creator with this email signs in as that creator, not as a new
    # traveller (which would also lock them out of their creator account).
    creator = await session.scalar(
        select(Creator).where(func.lower(Creator.email) == email.lower(), Creator.user_id.is_(None))
    )
    user = User(
        email=email.lower(),
        hashed_password=hash_password(secrets.token_urlsafe(24)),
        full_name=full_name,
        role=Role.CREATOR if creator else Role.TRAVELER,
    )
    session.add(user)
    await session.flush()
    if creator:
        creator.user_id = user.id
    return user, True


async def update(session: AsyncSession, user: User, data: UserUpdate) -> User:
    changes = data.model_dump(exclude_unset=True)
    if password := changes.pop("password", None):
        user.hashed_password = hash_password(password)
    for field, value in changes.items():
        setattr(user, field, value)
    await session.flush()
    return user


async def list_users(
    session: AsyncSession, role: Role | None, page: int, page_size: int
) -> tuple[list[User], int]:
    query = select(User)
    if role:
        query = query.where(User.role == role)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(
        query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    return list(rows), total
