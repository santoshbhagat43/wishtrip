import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, Text
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
