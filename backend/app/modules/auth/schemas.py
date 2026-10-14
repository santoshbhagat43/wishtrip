from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    # Plain str: login only looks the address up, and must work for local test domains (.test).
    email: str = Field(max_length=255)
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = ""
    # A creator's referral code (from their /c/<code> link) and the visitor id that opened it.
    referral_code: str | None = Field(default=None, max_length=64)
    visitor_id: str = Field(default="", max_length=64)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
