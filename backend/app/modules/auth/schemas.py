import re
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator


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


class GoogleExchange(BaseModel):
    # The one-time auth code from Google and the exact redirect_uri the SSO app used (Google
    # requires them to match). The code is exchanged server-side with the client secret.
    code: str = Field(min_length=1, max_length=2048)
    redirect_uri: str = Field(min_length=1, max_length=1000)
    # Same as RegisterRequest: the creator whose link brought this visitor, credited only if
    # this Google sign-in creates a new account.
    referral_code: str | None = Field(default=None, max_length=64)
    visitor_id: str = Field(default="", max_length=64)


_E164 = re.compile(r"\+[1-9]\d{6,14}")


class CreatorOtpRequest(BaseModel):
    """Ask for a sign-in code by email, or on WhatsApp to a number in international format."""

    channel: Literal["email", "whatsapp"] = "email"
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _one_address(self):
        if self.channel == "email" and not self.email:
            raise ValueError("An email address is needed for an email code")
        if self.channel == "whatsapp" and not (self.phone and _E164.fullmatch(self.phone)):
            raise ValueError("A WhatsApp number in international format (+91…) is needed")
        return self

    @property
    def identifier(self) -> str:
        return str(self.email).lower() if self.channel == "email" else self.phone or ""


class CreatorOtpVerify(CreatorOtpRequest):
    code: str = Field(min_length=4, max_length=8)
