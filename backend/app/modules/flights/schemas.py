import datetime as dt

from pydantic import BaseModel, Field, model_validator

CABINS = "^(ECONOMY|PREMIUM_ECONOMY|BUSINESS|FIRST)$"


class Leg(BaseModel):
    origin: str = Field(min_length=3, max_length=3, description="IATA airport or city code")
    destination: str = Field(min_length=3, max_length=3)
    date: dt.date

    @model_validator(mode="after")
    def _check(self):
        self.origin, self.destination = self.origin.upper(), self.destination.upper()
        if self.origin == self.destination:
            raise ValueError("origin and destination must differ")
        if self.date < dt.date.today():
            raise ValueError("date must be today or later")
        return self


class FlightSearch(BaseModel):
    # One leg = one-way, two = return, 2 to 6 = multi-city.
    legs: list[Leg] = Field(min_length=1, max_length=6)
    adults: int = Field(1, ge=1, le=9)
    children: int = Field(0, ge=0, le=8)
    infants: int = Field(0, ge=0, le=9)
    cabin: str = Field("ECONOMY", pattern=CABINS)
    direct_only: bool = False
    airlines: list[str] = Field(default_factory=list, max_length=10)
    # "price" (cheapest first), "duration" (shortest first) or "departure" (earliest first).
    sort: str = Field("price", pattern="^(price|duration|departure)$")

    @model_validator(mode="after")
    def _check(self):
        if self.adults + self.children > 9:
            raise ValueError("at most 9 travellers (adults and children)")
        if self.infants > self.adults:
            raise ValueError("infants cannot outnumber adults")
        for a, b in zip(self.legs, self.legs[1:], strict=False):
            if b.date < a.date:
                raise ValueError("legs must be in date order")
        return self

    def to_tripjack(self) -> dict:
        pax = {"ADULT": str(self.adults)}
        if self.children:
            pax["CHILD"] = str(self.children)
        if self.infants:
            pax["INFANT"] = str(self.infants)
        query: dict = {
            "cabinClass": self.cabin,
            "paxInfo": pax,
            "routeInfos": [
                {
                    "fromCityOrAirport": {"code": leg.origin},
                    "toCityOrAirport": {"code": leg.destination},
                    "travelDate": leg.date.isoformat(),
                }
                for leg in self.legs
            ],
        }
        modifiers: dict = {}
        if self.direct_only:
            modifiers["isDirectFlight"] = True
        if modifiers:
            query["searchModifiers"] = modifiers
        if self.airlines:
            query["preferredAirline"] = [{"code": a.upper()} for a in self.airlines]
        return query


class FareRuleQuery(BaseModel):
    price_id: str = Field(min_length=3)
