import enum
import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class Role(enum.StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    SUPPORT = "support"
    TRAVELER = "traveler"
    CREATOR = "creator"


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
    # The specific reel link they came through, if any — so a link's trips and earnings can be
    # counted. Same first-touch rule as the creator above.
    referred_via_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "creator_links.id", ondelete="SET NULL", use_alter=True, name="fk_users_via_link"
        )
    )
