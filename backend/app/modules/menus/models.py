import enum
import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class MenuPlacement(enum.StrEnum):
    """Where on the traveler website a group of links appears."""

    HEADER = "header"
    FOOTER = "footer"
    MOBILE = "mobile"


class MenuGroup(UUIDPrimaryKey, Timestamps, Base):
    """A named set of links the business team controls without a deploy."""

    __tablename__ = "menu_groups"
    __table_args__ = (UniqueConstraint("slug", name="uq_menu_groups_slug"),)

    name: Mapped[str] = mapped_column(String(80))
    slug: Mapped[str] = mapped_column(String(80), index=True)
    placement: Mapped[MenuPlacement] = mapped_column(
        str_enum(MenuPlacement), default=MenuPlacement.HEADER
    )
    position: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)

    items: Mapped[list["MenuItem"]] = relationship(
        back_populates="group", order_by="MenuItem.position", cascade="all, delete-orphan"
    )


class MenuItem(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "menu_items"

    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("menu_groups.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(80))
    # Either a plain path ("/explore") or a link to a place we hold, which keeps the URL
    # correct even when the place is renamed.
    url: Mapped[str] = mapped_column(String(500), default="")
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    opens_in_new_tab: Mapped[bool] = mapped_column(default=False)

    group: Mapped[MenuGroup] = relationship(back_populates="items")
    location: Mapped["Location | None"] = relationship(lazy="joined")  # noqa: F821
