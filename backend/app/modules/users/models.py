import enum

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class Role(enum.StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    SUPPORT = "support"
    TRAVELER = "traveler"


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[Role] = mapped_column(str_enum(Role), default=Role.TRAVELER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
