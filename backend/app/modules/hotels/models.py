import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPrimaryKey


class SupplierRegion(UUIDPrimaryKey, Timestamps, Base):
    """A TripJack city region. Linked to one of our knowledge-base cities when we know it."""

    __tablename__ = "supplier_regions"

    region_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    city_name: Mapped[str] = mapped_column(String(255), index=True)
    country_name: Mapped[str] = mapped_column(String(100), index=True)
    full_name: Mapped[str] = mapped_column(String(500), default="")
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL"), index=True
    )
    # Hotel ids (mapping) and their content are pulled per region, on demand.
    mapping_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hotel_count: Mapped[int] = mapped_column(Integer, default=0)


class SupplierHotel(UUIDPrimaryKey, Timestamps, Base):
    """Static catalogue data for a TripJack hotel. Prices and availability are never stored."""

    __tablename__ = "supplier_hotels"
    __table_args__ = (
        # Typo-tolerant search over hotel names (see hotels/matching.py and photos.py).
        Index(
            "ix_supplier_hotels_name_trgm",
            text("lower(name) gin_trgm_ops"),
            postgresql_using="gin",
        ),
    )

    tj_hotel_id: Mapped[str] = mapped_column(String(32), unique=True)
    unica_id: Mapped[str] = mapped_column(String(32), default="")
    region_id: Mapped[int] = mapped_column(BigInteger, index=True)
    # Null until the content has been fetched.
    content_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    name: Mapped[str] = mapped_column(String(500), default="")
    is_active: Mapped[bool] = mapped_column(default=True)
    star_rating: Mapped[float | None] = mapped_column(Float)
    property_type: Mapped[str] = mapped_column(String(100), default="")
    address: Mapped[str] = mapped_column(String(1000), default="")
    city: Mapped[str] = mapped_column(String(255), default="")
    country: Mapped[str] = mapped_column(String(100), default="")
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    hero_image: Mapped[str | None] = mapped_column(String(1000))
    # [{"caption": "...", "url": "..."}] — a handful, hero first.
    images: Mapped[list] = mapped_column(JSONB, default=list)
    amenities: Mapped[list] = mapped_column(JSONB, default=list)
    headline: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    policies: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Search order: better-described, better-rated hotels go to Listing first.
    rank: Mapped[float] = mapped_column(Float, default=0, index=True)


class StayMatch(UUIDPrimaryKey, Timestamps, Base):
    """Which TripJack hotel a creator trip's stay is. Matched by name when the trip is first read,
    then kept: staff can confirm it, change it, or say there is none.

      matched    a confident automatic match (its photo is shown)
      review     a likely match that staff should confirm (no photo is shown yet)
      nomatch    nothing close in the catalogue (yet: it is tried again as hotels are fetched)
      confirmed  staff chose this hotel (its photo is shown)
      unlinked   staff said no hotel fits: nothing is shown, and it is not matched again
    """

    __tablename__ = "stay_matches"
    __table_args__ = (UniqueConstraint("trip_id", "item_id"),)

    trip_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("creator_trips.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str] = mapped_column(String(40))
    # The stay's name when it was matched (a renamed stay is matched again, unless staff decided).
    stay_name: Mapped[str] = mapped_column(String(255), default="")
    hotel_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("supplier_hotels.id", ondelete="SET NULL"), index=True
    )
    score: Mapped[float] = mapped_column(Float, default=0)
    state: Mapped[str] = mapped_column(String(12), default="nomatch", index=True)
    decided_by: Mapped[str] = mapped_column(String(255), default="")
