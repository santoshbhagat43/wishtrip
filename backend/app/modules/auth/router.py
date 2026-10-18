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
    RegisterRequest,
    TokenPair,
)
from app.modules.creators import service as creators
from app.modules.users import service as users
from app.modules.users.models import Role, User
from app.modules.users.schemas import UserCreate, UserRead

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


@router.post("/register", response_model=TokenPair, status_code=201)
async def register(data: RegisterRequest, session: AsyncSession = Depends(get_session)):
    """Public sign-up always creates a traveler; staff accounts are created by admins."""
    fields = data.model_dump(exclude={"referral_code", "visitor_id"})
    user = await users.create(session, UserCreate(**fields, role=Role.TRAVELER))
    await creators.credit_signup(session, user, data.referral_code, data.visitor_id)
    await session.commit()
    return _tokens(user)


@router.post("/google/exchange", response_model=TokenPair)
async def google_exchange(data: GoogleExchange, session: AsyncSession = Depends(get_session)):
    """Exchange a Google auth code (from the SSO app) for a wishtrip token pair."""
    claims = await google.exchange_code(data.code, data.redirect_uri)
    user, created = await users.get_or_create_google_user(
        session, email=claims["email"], full_name=claims.get("name", "")
    )
    # Only a new traveller is a referral; a creator signing in for the first time is not.
    if created and user.role == Role.TRAVELER:
        await creators.credit_signup(session, user, data.referral_code, data.visitor_id)
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
    if data.channel == "whatsapp" and not await creators.whatsapp_is_known(session, data.phone):
        return {"sent": True}
    await otp.issue(data.channel, data.identifier)
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
