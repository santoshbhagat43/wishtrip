import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.errors import bad_request
from app.core.security import create_token, decode_token, verify_password
from app.db.session import get_session
from app.modules.auth import google, otp
from app.modules.auth.schemas import (
    CreatorOtpRequest,
    CreatorOtpVerify,
    GoogleExchange,
    LoginRequest,
    RefreshRequest,
    TokenPair,
    TravelerOtpRequest,
    TravelerOtpVerify,
)
from app.modules.creators import service as creators
from app.modules.users import service as users
from app.modules.users.models import Role, User
from app.modules.users.schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user.id, user.role, "access"),
        refresh_token=create_token(user.id, user.role, "refresh"),
    )


@router.post("/login", response_model=TokenPair)
async def login(data: LoginRequest, session: AsyncSession = Depends(get_session)):
    user = await users.get_by_email(session, data.email)
    if not user or not user.is_active or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return _tokens(user)


@router.post("/otp/request", status_code=202)
async def traveler_request_otp(data: TravelerOtpRequest):
    """Email a traveller a one-time sign-in code. There are no passwords for travellers.

    Always answers the same way, so it can't be used to discover who has an account.
    """
    try:
        await otp.issue("email", str(data.email).lower())
    except otp.OtpUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, exc.message) from exc
    except otp.OtpDeliveryFailed as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "We couldn't send the code. Please try again in a moment."
        ) from exc
    return {"sent": True}


@router.post("/otp/verify", response_model=TokenPair)
async def traveler_verify(data: TravelerOtpVerify, session: AsyncSession = Depends(get_session)):
    """Check the code and sign the traveller in; a first sign-in creates their account.

    Staff sign in with a password, not here: a code to an inbox must not open a team account.
    """
    email = str(data.email).lower()
    if not await otp.check("email", email, data.code):
        raise bad_request("That code isn't right, or it has expired. Ask for a new one.")
    user, created = await users.get_or_create_passwordless_user(session, email=email)
    if user.role not in (Role.TRAVELER, Role.CREATOR):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Team accounts sign in with a password, on the dashboard."
        )
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled.")
    if created and user.role == Role.TRAVELER:
        await creators.credit_signup(
            session, user, data.referral_code, data.visitor_id, data.link_code
        )
    await session.commit()
    return _tokens(user)


@router.post("/google/exchange", response_model=TokenPair)
async def google_exchange(data: GoogleExchange, session: AsyncSession = Depends(get_session)):
    """Exchange a Google auth code (from the SSO app) for a wishtrip token pair."""
    claims = await google.exchange_code(data.code, data.redirect_uri)
    user, created = await users.get_or_create_passwordless_user(
        session, email=claims["email"], full_name=claims.get("name", "")
    )
    # Only a new traveller is a referral; a creator signing in for the first time is not.
    if created and user.role == Role.TRAVELER:
        await creators.credit_signup(
            session, user, data.referral_code, data.visitor_id, data.link_code
        )
    await session.commit()
    return _tokens(user)


@router.post("/creator/request-otp", status_code=202)
async def creator_request_otp(
    data: CreatorOtpRequest, session: AsyncSession = Depends(get_session)
):
    """Send a creator a one-time sign-in code, by email or on WhatsApp.

    Always answers the same way, so it can't be used to discover who is a creator. WhatsApp codes
    only go to numbers a creator gave when applying; an email can be new (it signs up a pending
    creator).
    """
    try:
        otp.ensure_available(data.channel)  # first, and the same for everyone: nothing is revealed
        if data.channel == "whatsapp" and not await creators.whatsapp_is_known(session, data.phone):
            return {"sent": True}
        await otp.issue(data.channel, data.identifier)
    except otp.OtpUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, exc.message) from exc
    except otp.OtpDeliveryFailed as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "We couldn't send the code. Please try again in a moment."
        ) from exc
    return {"sent": True}


@router.post("/creator/verify", response_model=TokenPair)
async def creator_verify(data: CreatorOtpVerify, session: AsyncSession = Depends(get_session)):
    """Check the code and sign the creator in (a first email sign-in makes a pending creator)."""
    if not await otp.check(data.channel, data.identifier, data.code):
        raise bad_request("That code isn't right, or it has expired. Ask for a new one.")
    user = await creators.sign_in_creator(
        session,
        email=str(data.email) if data.channel == "email" else None,
        whatsapp=data.phone if data.channel == "whatsapp" else None,
    )
    await session.commit()
    return _tokens(user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, session: AsyncSession = Depends(get_session)):
    try:
        payload = decode_token(data.refresh_token, "refresh")
        user = await session.get(User, uuid.UUID(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        user = None
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    return _tokens(user)


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user)):
    return user
