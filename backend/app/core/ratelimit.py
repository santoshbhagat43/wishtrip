"""A simple shared counter in Redis ("at most N a window"). If Redis is down it allows: a rate
limit must never be the reason something is refused. A connection is made per call, because the
workers run each task in its own event loop and a client cannot outlive its loop."""

import contextlib
import logging

import redis.asyncio as aioredis

from app.core.config import settings

log = logging.getLogger(__name__)


async def allow(key: str, limit: int, window_seconds: int = 3600) -> bool:
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        count = await client.incr(f"rl:{key}")
        if count == 1:
            await client.expire(f"rl:{key}", window_seconds)
        return count <= limit
    except Exception:  # noqa: BLE001
        log.warning("rate limit unavailable; allowing", exc_info=True)
        return True
    finally:
        with contextlib.suppress(Exception):
            await client.aclose()
