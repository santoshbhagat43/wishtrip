import datetime as dt

from pydantic import BaseModel, Field, model_validator

BLOCKED = {"MM", "IR", "KP"}  # Myanmar, Iran, North Korea
STUDENT_DAYS = {30, 60, 90, 120, 180, 240, 270, 365, 730}
AMT_COVERAGE = {30, 45, 60, 90}


class Destination(BaseModel):
    # ISO country code for COUNTRY (IN, US), or a region code (EUR, SCH, ASI, ...) otherwise.
    key: str = Field(min_length=2, max_length=8)
    type: str = Field("COUNTRY", pattern="^(COUNTRY|REGION|POPULARREGION)$")

    @model_validator(mode="after")
    def _upper(self):
        self.key = self.key.upper()
        return self


class InsuranceSearch(BaseModel):
    start_date: dt.date
    end_date: dt.date | None = None
    traveller_dobs: list[dt.date] = Field(min_length=1, max_length=10)
    destinations: list[Destination] = Field(min_length=1)
    # None = regular one-off trip cover.
    plan_type: str | None = Field(None, pattern="^(STUDENT|AMT)$")
    coverage_duration: int | None = None

    @model_validator(mode="after")
    def _rules(self):
        today = dt.date.today()
        if self.start_date < today:
            raise ValueError("start_date must be today or later")
        if any(d.key in BLOCKED and d.type == "COUNTRY" for d in self.destinations):
            raise ValueError("Cover is not offered for Myanmar, Iran or North Korea")
        for dob in self.traveller_dobs:
            age = (today - dob).days / 365.25
            if age < 0:
                raise ValueError("a date of birth is in the future")
            if age > 70:
                raise ValueError("Cover is not offered to travellers over 70")
        if self.plan_type == "AMT":
            if self.coverage_duration not in AMT_COVERAGE:
                raise ValueError("AMT coverage_duration must be 30, 45, 60 or 90")
            return self
        if self.end_date is None and self.coverage_duration is None:
            raise ValueError("Give end_date or coverage_duration")
        days = (
            (self.end_date - self.start_date).days + 1
            if self.end_date
            else self.coverage_duration
        )
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        if self.plan_type == "STUDENT" and days not in STUDENT_DAYS:
            raise ValueError(
                "Student trips must be 30, 60, 90, 120, 180, 240, 270, 365 or 730 days"
            )
        if self.plan_type is None and self.journey == "DOMESTIC" and days > 30:
            raise ValueError("Domestic cover is limited to 30 days")
        return self

    @property
    def journey(self) -> str:
        return "DOMESTIC" if any(d.key == "IN" for d in self.destinations) else "INTERNATIONAL"

    def to_tripjack(self) -> dict:
        body: dict = {
            "startDate": self.start_date.isoformat(),
            "travellerDobs": [d.isoformat() for d in self.traveller_dobs],
            "destinations": [d.model_dump() for d in self.destinations],
        }
        if self.end_date and self.plan_type != "AMT":
            body["endDate"] = self.end_date.isoformat()
        if self.coverage_duration:
            body["coverageDuration"] = self.coverage_duration
        if self.plan_type:
            body["planType"] = self.plan_type
            body["funnelType"] = self.plan_type
        else:
            body["journeyType"] = self.journey
        return body
