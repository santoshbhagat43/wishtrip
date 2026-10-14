import enum
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum


class LocationType(enum.StrEnum):
    COUNTRY = "country"
    CITY = "city"
    ATTRACTION = "attraction"
    HOTEL = "hotel"
    RESTAURANT = "restaurant"
    ACTIVITY = "activity"
    EXPERIENCE = "experience"
    ROUTE = "route"


CONTAINER_TYPES = {LocationType.COUNTRY, LocationType.CITY}
PLACE_TYPES = [t for t in LocationType if t not in CONTAINER_TYPES]


class LocationStatus(enum.StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class TimeOfDay(enum.StrEnum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"


class Season(enum.StrEnum):
    SPRING = "spring"
    SUMMER = "summer"
    AUTUMN = "autumn"
    WINTER = "winter"


class RelationType(enum.StrEnum):
    NEAR = "near"
    ROUTE_TO = "route_to"
    PAIRS_WITH = "pairs_with"
    SIMILAR_TO = "similar_to"
    ALTERNATIVE_TO = "alternative_to"


class TagCategory(enum.StrEnum):
    INTEREST = "interest"
    CUISINE = "cuisine"
    STYLE = "style"
    AMENITY = "amenity"


location_tags = Table(
    "location_tags",
    Base.metadata,
    Column("location_id", ForeignKey("locations.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(UUIDPrimaryKey, Base):
    __tablename__ = "tags"

    name: Mapped[str] = mapped_column(String(64))
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    category: Mapped[TagCategory] = mapped_column(
        str_enum(TagCategory), default=TagCategory.INTEREST
    )


class Location(UUIDPrimaryKey, Timestamps, Base):
    """Any place WishTrip knows about. Countries and cities are containers for the rest."""

    __tablename__ = "locations"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_locations_source_external_id"),
        Index(
            "ix_locations_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        CheckConstraint("cost_level BETWEEN 0 AND 4", name="ck_locations_cost_level"),
        CheckConstraint("energy_level BETWEEN 1 AND 5", name="ck_locations_energy_level"),
        CheckConstraint("difficulty BETWEEN 1 AND 5", name="ck_locations_difficulty"),
    )

    type: Mapped[LocationType] = mapped_column(str_enum(LocationType), index=True)
    status: Mapped[LocationStatus] = mapped_column(
        str_enum(LocationStatus), default=LocationStatus.DRAFT, index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT"), index=True
    )

    # Basic information
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    summary: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    address: Mapped[str] = mapped_column(String(500), default="")
    # State/region travellers name a trip by ("Kerala"), set on cities.
    region: Mapped[str] = mapped_column(String(100), default="", index=True)
    # Other names travellers use for this place ("Dharamshala" for McLeod Ganj, "Munnar").
    aliases: Mapped[list[str]] = mapped_column(ARRAY(String(100)), default=list)
    # Must-see anchor (the client KB's "marquee" flag).
    highlight: Mapped[bool] = mapped_column(Boolean, default=False)

    # Travel information
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    best_times: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list)
    seasons: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list)
    opening_hours: Mapped[dict] = mapped_column(JSONB, default=dict)
    cost_level: Mapped[int | None] = mapped_column(SmallInteger)
    price_note: Mapped[str] = mapped_column(String(255), default="")

    # Characteristics
    energy_level: Mapped[int | None] = mapped_column(SmallInteger)
    difficulty: Mapped[int | None] = mapped_column(SmallInteger)
    family_friendly: Mapped[bool | None] = mapped_column(Boolean)
    couple_friendly: Mapped[bool | None] = mapped_column(Boolean)
    accessible: Mapped[bool | None] = mapped_column(Boolean)

    # Qualitative knowledge
    pros: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    cons: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    tips: Mapped[str] = mapped_column(Text, default="")
    # Countries and cities: a written history (background, culture, what it's known for).
    # Given to the planner as background for trips there.
    history: Mapped[str] = mapped_column(Text, default="", server_default="")

    # Where a record came from. Imports upsert on (source, external_id).
    source: Mapped[str] = mapped_column(String(64), default="manual")
    external_id: Mapped[str | None] = mapped_column(String(255))
    # coordinate_precision, needs_verification, source URLs, verified dates.
    provenance: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Staff-only, unverified data (e.g. indicative rates). Never shown to travelers or the AI.
    reference: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Semantic layer
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.embedding_dimensions), deferred=True
    )
    embedded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    embedding_model: Mapped[str | None] = mapped_column(String(100))

    parent: Mapped["Location | None"] = relationship(
        remote_side="Location.id", lazy="joined", join_depth=1
    )
    tags: Mapped[list[Tag]] = relationship(secondary=location_tags, lazy="selectin")


class LocationRelation(UUIDPrimaryKey, Base):
    __tablename__ = "location_relations"
    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "relation", name="uq_location_relation"),
        CheckConstraint("source_id <> target_id", name="ck_location_relation_not_self"),
    )

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), index=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"), index=True
    )
    relation: Mapped[RelationType] = mapped_column(str_enum(RelationType))
    distance_meters: Mapped[int | None] = mapped_column(Integer)
    travel_minutes: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(500), default="")

    source: Mapped[Location] = relationship(foreign_keys=[source_id], lazy="joined")
    target: Mapped[Location] = relationship(foreign_keys=[target_id], lazy="joined")
