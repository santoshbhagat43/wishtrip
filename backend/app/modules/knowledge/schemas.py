import enum
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.modules.knowledge.models import (
    LocationStatus,
    LocationType,
    RelationType,
    Season,
    TagCategory,
    TimeOfDay,
)


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    category: TagCategory


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    category: TagCategory = TagCategory.INTEREST


class LocationRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    type: LocationType


class LocationFields(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    summary: str = Field("", max_length=500)
    description: str = ""
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    address: str = ""
    region: str = Field("", max_length=100)
    aliases: list[str] = []
    highlight: bool = False
    duration_minutes: int | None = Field(None, ge=0, le=60 * 24 * 14)
    best_times: list[TimeOfDay] = []
    seasons: list[Season] = []
    opening_hours: dict[str, str] = {}
    cost_level: int | None = Field(None, ge=0, le=4)
    price_note: str = ""
    energy_level: int | None = Field(None, ge=1, le=5)
    difficulty: int | None = Field(None, ge=1, le=5)
    family_friendly: bool | None = None
    couple_friendly: bool | None = None
    accessible: bool | None = None
    pros: list[str] = []
    cons: list[str] = []
    tips: str = ""
    history: str = ""


class LocationCreate(LocationFields):
    type: LocationType
    parent_id: uuid.UUID | None = None
    status: LocationStatus = LocationStatus.DRAFT
    tag_ids: list[uuid.UUID] = []


class LocationUpdate(BaseModel):
    """Every field optional; only fields sent are changed."""

    name: str | None = Field(None, min_length=1, max_length=255)
    parent_id: uuid.UUID | None = None
    status: LocationStatus | None = None
    tag_ids: list[uuid.UUID] | None = None
    summary: str | None = Field(None, max_length=500)
    description: str | None = None
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    address: str | None = None
    region: str | None = Field(None, max_length=100)
    aliases: list[str] | None = None
    highlight: bool | None = None
    provenance: dict | None = None
    duration_minutes: int | None = Field(None, ge=0, le=60 * 24 * 14)
    best_times: list[TimeOfDay] | None = None
    seasons: list[Season] | None = None
    opening_hours: dict[str, str] | None = None
    cost_level: int | None = Field(None, ge=0, le=4)
    price_note: str | None = None
    energy_level: int | None = Field(None, ge=1, le=5)
    difficulty: int | None = Field(None, ge=1, le=5)
    family_friendly: bool | None = None
    couple_friendly: bool | None = None
    accessible: bool | None = None
    pros: list[str] | None = None
    cons: list[str] | None = None
    tips: str | None = None
    history: str | None = None


# Fields the AI and ranking rely on; missing ones make a place harder to recommend well.
COMPLETENESS_FIELDS: dict[str, tuple[str, ...]] = {
    "summary": ("summary",),
    "description": ("description",),
    "coordinates": ("latitude", "longitude"),
    "duration": ("duration_minutes",),
    "best time": ("best_times",),
    "cost": ("cost_level",),
    "energy level": ("energy_level",),
    "suitability": ("family_friendly", "couple_friendly"),
    "pros": ("pros",),
    "tags": ("tags",),
}
CONTAINER_COMPLETENESS = ("summary", "description", "coordinates")


class LocationListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: LocationType
    status: LocationStatus
    name: str
    slug: str
    summary: str
    parent: LocationRef | None
    tags: list[TagRead]
    region: str
    highlight: bool
    source: str
    provenance: dict
    embedded_at: datetime | None
    embedding_model: str | None
    updated_at: datetime

    # Populated from the ORM object by the validator in service.to_list_item.
    completeness: float = 1.0
    missing_fields: list[str] = []


class PublicLocation(BaseModel):
    """What travelers may see: no provenance, source, reference data, status or index state."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: LocationType
    name: str
    slug: str
    summary: str
    region: str
    highlight: bool
    parent: LocationRef | None
    tags: list[TagRead]
    latitude: float | None
    longitude: float | None
    duration_minutes: int | None
    best_times: list[str]
    cost_level: int | None
    # Verified price text only; null/empty means "not available yet".
    price_note: str
    family_friendly: bool | None
    couple_friendly: bool | None
    accessible: bool | None


class LocationRead(LocationFields, LocationListItem):
    parent_id: uuid.UUID | None
    external_id: str | None
    reference: dict
    ancestors: list[LocationRef] = []
    children_count: int = 0
    created_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def embedding_stale(self) -> bool:
        return self.status == LocationStatus.PUBLISHED and (
            self.embedded_at is None or self.embedded_at < self.updated_at
        )


class RelationCreate(BaseModel):
    target_id: uuid.UUID
    relation: RelationType
    distance_meters: int | None = Field(None, ge=0)
    travel_minutes: int | None = Field(None, ge=0)
    note: str = ""


class RelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    relation: RelationType
    source: LocationRef
    target: LocationRef
    distance_meters: int | None
    travel_minutes: int | None
    note: str


class KnowledgeStats(BaseModel):
    total: int
    by_type: dict[str, int]
    by_status: dict[str, int]
    incomplete: int
    embeddings_pending: int
    relations: int
    tags: int


class ReviewCheck(BaseModel):
    """One automatic check on a record, as the review queue shows it."""

    ok: bool
    label: str


class ReviewReason(enum.StrEnum):
    """Why a record is waiting for a person. One record can only queue under its first reason."""

    DRAFT = "draft"
    UNVERIFIED = "unverified"
    INCOMPLETE = "incomplete"
    STALE_INDEX = "stale_index"


class ReviewItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: LocationType
    status: LocationStatus
    name: str
    summary: str
    parent: LocationRef | None
    region: str
    source: str
    updated_at: datetime
    embedded_at: datetime | None

    reason: ReviewReason
    completeness: float
    missing_fields: list[str]
    checks: list[ReviewCheck]
    # Staff-only reference data this record carries (indicative rates and the like), by key.
    reference_keys: list[str]


class ReviewQueue(BaseModel):
    """Counts are for the whole queue; items are the requested page of one reason."""

    counts: dict[str, int]
    # For the incomplete backlog: how many records are missing each planning field.
    missing_by_field: dict[str, int]
    total: int
    oldest_updated_at: datetime | None
    items: list[ReviewItem]


class DestinationRow(BaseModel):
    id: uuid.UUID
    name: str
    status: LocationStatus
    region: str
    country: str
    country_id: uuid.UUID | None = None
    summary: str = ""
    # Words in the city's written history (0 = not written yet).
    history_words: int = 0
    # Places in each section of the city page (any status).
    hotels: int = 0
    experiences: int = 0
    food: int = 0
    published: int
    draft: int
    incomplete: int
    embedded: int
    # Chat sessions whose trip state named this city.
    trips: int
    # Chat sessions that named this city's region instead (shared across the region's cities).
    region_trips: int
    updated_at: datetime


class SystemStatus(BaseModel):
    """What the stack is actually running, for the System health screen."""

    ai_enabled: bool
    llm_provider: str
    chat_model: str
    intent_model: str
    embedder: str
    embedding_dimensions: int
    embeddings_pending: int
    oldest_stale_embed: datetime | None
    counts: dict[str, int]
    last_audit_at: datetime | None
