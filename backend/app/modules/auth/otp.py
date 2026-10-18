"""One-time sign-in codes for creators, by email or WhatsApp.

A code is six random digits, stored only as a keyed hash, valid for `otp_ttl_seconds`, good for
one sign-in, and burnt after `otp_max_attempts` wrong guesses. A new code can be requested every
`otp_resend_seconds`.

Each channel is "live" once its provider is configured (email: SMTP settings; WhatsApp: no
provider is wired yet). A channel that isn't live falls back to the fixed `creator_dev_otp`, so
creators can still sign in before a provider exists — see the warning on that setting.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import smtplib
import time
from email.message import EmailMessage
from typing import Literal, Protocol

from app.core.config import settings

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


def channel_is_live(channel: Channel) -> bool:
    """Does this channel send real codes? If not, it uses the fixed dev code."""
    if channel == "email":
        return bool(settings.smtp_host and settings.smtp_from)
    # WhatsApp: no provider is wired yet (Meta Cloud API, Twilio and Gupshup each need their own
    # integration and an approved message template).
    return False


def _send_email(to: str, code: str) -> None:
    message = EmailMessage()
    message["Subject"] = f"{code} is your WishTrip sign-in code"
    message["From"] = settings.smtp_from
    message["To"] = to
    minutes = settings.otp_ttl_seconds // 60
    message.set_content(
        f"Your WishTrip sign-in code is {code}\n\n"
        f"It works once and expires in {minutes} minutes. "
        "If you didn't ask for it, you can ignore this email."
    )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)


async def _deliver(channel: Channel, to: str, code: str) -> None:
    if channel == "email":
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
    if not channel_is_live(channel):
        logger.info("Sign-in code for %s via %s: fixed dev code (no provider)", identifier, channel)
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
    await deliver(channel, identifier, code)


async def check(channel: Channel, identifier: str, code: str) -> bool:
    """True once for the right code; wrong guesses count towards burning it."""
    code = code.strip()
    if not channel_is_live(channel):
        return hmac.compare_digest(code, settings.creator_dev_otp)

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
