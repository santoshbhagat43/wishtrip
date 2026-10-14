import enum
import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class Role(enum.StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    TRAVELER = "traveler"


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[Role] = mapped_column(str_enum(Role), default=Role.TRAVELER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # The creator credited with bringing this traveller in (first touch wins). use_alter breaks
    # the users ⇄ creators foreign-key cycle when the schema is created.
    referred_by_creator_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creators.id", ondelete="SET NULL", use_alter=True, name="fk_users_referred_by")
    )
