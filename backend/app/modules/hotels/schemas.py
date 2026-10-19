import datetime as dt

from pydantic import BaseModel, Field, model_validator


class Room(BaseModel):
    adults: int = Field(2, ge=1, le=6)
    child_ages: list[int] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def _ages(self):
        if any(a < 0 or a > 17 for a in self.child_ages):
            raise ValueError("child ages must be 0-17")
        return self

    def to_tripjack(self) -> dict:
        room: dict = {"adults": self.adults}
        if self.child_ages:
            room["children"] = len(self.child_ages)
            room["childAge"] = self.child_ages
        return room


class StayQuery(BaseModel):
    check_in: dt.date
    check_out: dt.date
    rooms: list[Room] = Field(default_factory=lambda: [Room()], min_length=1, max_length=9)
    # TripJack countryId of the guest's nationality; default comes from settings.
    nationality: str | None = None

    @model_validator(mode="after")
    def _dates(self):
        if self.check_in < dt.date.today():
            raise ValueError("check_in must be today or later")
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self


class HotelSearch(StayQuery):
    # Either one of these picks the destination.
    region_id: int | None = None
    city: str | None = Field(None, min_length=2)
    location_id: str | None = None
    # "price" (cheapest first) or "rank" (best-presented first).
    sort: str = Field("price", pattern="^(price|rank)$")


class HotelPricing(StayQuery):
    correlation_id: str | None = None
