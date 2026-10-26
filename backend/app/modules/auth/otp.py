"""One-time sign-in codes for creators, by email or WhatsApp.

A code is six random digits, stored only as a keyed hash, valid for `otp_ttl_seconds`, good for
one sign-in, and burnt after `otp_max_attempts` wrong guesses. A new code can be requested every
`otp_resend_seconds`.

Email is "live" once Trustsignal is configured (key, sender and template; SMTP still works as a
second provider). WhatsApp is not wired yet: Trustsignal will send it later, and for now only email
is offered. A channel that is not live sends nothing and says so: there is NO hardcoded fixed code
any more (it used to be 1234). A developer can opt in to one locally with CREATOR_DEV_OTP; it is
ignored when ENVIRONMENT=production.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Literal, Protocol

from app.core.config import settings
from app.modules.auth import trustsignal
from app.modules.emails import service as emails

logger = logging.getLogger(__name__)

Channel = Literal["email", "whatsapp"]


# --- Storage ---------------------------------------------------------------------------------


class OtpStore(Protocol):
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ttl: int) -> None: ...
    async def delete(self, key: str) -> None: ...


class RedisOtpStore:
    def __init__(self, url: str):
        from redis import asyncio as aioredis

        self._redis = aioredis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> str | None:
        return await self._redis.get(key)

    async def set(self, key: str, value: str, ttl: int) -> None:
        await self._redis.set(key, value, ex=ttl)

    async def delete(self, key: str) -> None:
        await self._redis.delete(key)


class MemoryOtpStore:
    """For tests: the same contract, in a dict, honouring expiry."""

    def __init__(self):
        self._data: dict[str, tuple[str, float]] = {}

    async def get(self, key: str) -> str | None:
        value = self._data.get(key)
        if value is None or value[1] < time.monotonic():
            self._data.pop(key, None)
            return None
        return value[0]

    async def set(self, key: str, value: str, ttl: int) -> None:
        self._data[key] = (value, time.monotonic() + ttl)

    async def delete(self, key: str) -> None:
        self._data.pop(key, None)


_store: OtpStore | None = None


def get_store() -> OtpStore:
    global _store
    if _store is None:
        _store = RedisOtpStore(settings.redis_url)
    return _store


def set_store(store: OtpStore | None) -> None:
    """Swap the store (tests)."""
    global _store
    _store = store


# --- Delivery --------------------------------------------------------------------------------


class OtpUnavailable(Exception):
    """This channel cannot send codes right now (no provider, or not offered yet)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class OtpDeliveryFailed(Exception):
    """The provider did not send the code. Nothing was stored, so the person can ask again."""


def dev_code() -> str | None:
    """A fixed sign-in code a developer opted in to (CREATOR_DEV_OTP). Not in production, unless
    ALLOW_FIXED_OTP_IN_PRODUCTION is also set (a test server with no email provider yet), and then
    only while no email provider is configured (see check()).

    HARDCODED FIXED CODE: DISABLED. The old behaviour (every non-live channel accepted
    `settings.creator_dev_otp`, which defaulted to "1234") let anyone who knew a creator's email
    sign in as them, so it is commented out here and off by default:

        # if not channel_is_live(channel):
        #     return hmac.compare_digest(code, settings.creator_dev_otp)   # "1234"
    """
    if settings.environment == "production" and not settings.allow_fixed_otp_in_production:
        return None
    return settings.creator_dev_otp or None


def channel_is_live(channel: Channel) -> bool:
    """Does this channel send real codes?"""
    if channel == "email":
        return trustsignal.email_configured() or bool(settings.smtp_host and settings.smtp_from)
    # WhatsApp: Trustsignal will send it (it needs an approved WhatsApp template). Not wired yet;
    # for now creators sign in by email.
    return False


def ensure_available(channel: Channel) -> None:
    """Raises OtpUnavailable, with something the person can read, if no code can be sent."""
    if channel_is_live(channel) or dev_code():
        return
    if channel == "whatsapp":
        raise OtpUnavailable("WhatsApp codes aren't available yet. Please use your email.")
    raise OtpUnavailable("We can't send sign-in codes right now. Please try again later.")


def _send_email(to: str, code: str) -> None:
    """The sign-in code, in the WishTrip email template (HTML and plain text). Raises if SMTP fails,
    so the person is told and can ask again."""
    subject, body_html, body_text = emails.render(
        "sign-in-code", code=code, expires_minutes=settings.otp_ttl_seconds // 60
    )
    emails.smtp_send(to, subject, body_html, body_text)


async def _deliver(channel: Channel, to: str, code: str) -> None:
    if channel == "email":
        if trustsignal.email_configured():
            await trustsignal.send_otp_email(to, code)
        else:
            await asyncio.to_thread(_send_email, to, code)


# Swappable for tests, which capture the code instead of sending it.
deliver = _deliver


# --- Issue and check -------------------------------------------------------------------------


def _key(channel: Channel, identifier: str) -> str:
    return f"otp:{channel}:{identifier.strip().lower()}"


def _hash(identifier: str, code: str) -> str:
    return hmac.new(
        settings.jwt_secret.encode(), f"{identifier.lower()}:{code}".encode(), hashlib.sha256
    ).hexdigest()


async def issue(channel: Channel, identifier: str) -> None:
    """Create and send a code. Quietly does nothing inside the resend window."""
    ensure_available(channel)
    if not channel_is_live(channel):
        # Only reachable when a developer opted in to CREATOR_DEV_OTP locally: nothing is sent.
        logger.info("Sign-in code for %s via %s: the local dev code applies", identifier, channel)
        return
    store = get_store()
    cooldown = f"{_key(channel, identifier)}:cooldown"
    if await store.get(cooldown):
        return
    code = f"{secrets.randbelow(10**6):06d}"
    expires = time.time() + settings.otp_ttl_seconds
    record = {"hash": _hash(identifier, code), "attempts": 0, "expires": expires}
    await store.set(_key(channel, identifier), json.dumps(record), settings.otp_ttl_seconds)
    await store.set(cooldown, "1", settings.otp_resend_seconds)
    try:
        await deliver(channel, identifier, code)
    except Exception as exc:  # noqa: BLE001 - whatever the provider did, the person must be able to retry
        # Nothing arrived, so the code must not exist and the resend wait must not apply.
        await store.delete(_key(channel, identifier))
        await store.delete(cooldown)
        logger.error("Could not send a sign-in code by %s: %s", channel, exc)
        raise OtpDeliveryFailed from exc


async def check(channel: Channel, identifier: str, code: str) -> bool:
    """True once for the right code; wrong guesses count towards burning it."""
    code = code.strip()
    if not channel_is_live(channel):
        fixed = dev_code()
        return bool(fixed) and hmac.compare_digest(code, fixed)

    store = get_store()
    key = _key(channel, identifier)
    raw = await store.get(key)
    if raw is None:
        return False
    record = json.loads(raw)
    if hmac.compare_digest(record["hash"], _hash(identifier, code)):
        await store.delete(key)  # single use
        return True
    record["attempts"] += 1
    if record["attempts"] >= settings.otp_max_attempts:
        await store.delete(key)  # too many guesses: ask for a new code
    else:
        # Keep the original expiry: wrong guesses must not extend a code's life.
        remaining = int(record["expires"] - time.time())
        if remaining > 0:
            await store.set(key, json.dumps(record), remaining)
        else:
            await store.delete(key)
    return False
