"""Short-lived Redis cache for TripJack search results. A cache outage never breaks a search."""

import hashlib
import json
import logging

import redis.asyncio as aioredis

from app.core.config import settings

log = logging.getLogger(__name__)
_redis: aioredis.Redis | None = None


def _client() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def cache_get(key: str) -> dict | None:
    try:
        raw = await _client().get(key)
        return json.loads(raw) if raw else None
    except Exception:
        log.warning("tripjack cache read failed", exc_info=True)
        return None


async def cache_set(key: str, value: dict, ttl: int) -> None:
    try:
        await _client().set(key, json.dumps(value), ex=ttl)
    except Exception:
        log.warning("tripjack cache write failed", exc_info=True)


def cache_key(prefix: str, *parts: object) -> str:
    digest = hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()
    return f"tj:{prefix}:{digest}"
