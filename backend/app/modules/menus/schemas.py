import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.modules.menus.models import MenuPlacement


class MenuItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    url: str
    location_id: uuid.UUID | None
    position: int
    is_active: bool
    opens_in_new_tab: bool
    # Resolved from the linked place, so staff see where a link actually goes.
    resolved_url: str = ""
    location_name: str | None = None


class MenuItemCreate(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    url: str = Field("", max_length=500)
    location_id: uuid.UUID | None = None
    position: int | None = None
    is_active: bool = True
    opens_in_new_tab: bool = False


class MenuItemUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=80)
    url: str | None = Field(None, max_length=500)
    location_id: uuid.UUID | None = None
    position: int | None = None
    is_active: bool | None = None
    opens_in_new_tab: bool | None = None


class MenuGroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    placement: MenuPlacement
    position: int
    is_active: bool
    items: list[MenuItemRead]


class MenuGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    placement: MenuPlacement = MenuPlacement.HEADER
    position: int | None = None
    is_active: bool = True


class MenuGroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    placement: MenuPlacement | None = None
    position: int | None = None
    is_active: bool | None = None


class PublicMenuItem(BaseModel):
    """What the traveler website renders: a label and a URL, nothing internal."""

    label: str
    url: str
    opens_in_new_tab: bool


class PublicMenu(BaseModel):
    name: str
    slug: str
    placement: MenuPlacement
    items: list[PublicMenuItem]
