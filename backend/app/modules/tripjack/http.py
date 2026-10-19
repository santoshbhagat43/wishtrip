"""Shared HTTP plumbing for every TripJack product (hotels, flights, insurance): one pooled
client per product, the apikey header, and the retry rules TripJack documents."""

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

BACKOFF_SECONDS = (1, 2, 4)


class TripJackError(Exception):
    def __init__(
        self, code: str, message: str, request_id: str = "", retryable: bool = False
    ) -> None:
        super().__init__(f"TripJack {code}: {message}")
        self.code = code
        self.message = message
        self.request_id = request_id
        self.retryable = retryable


class TripJackNotConfigured(Exception):
    pass


class TripJackHTTP:
    """Subclasses say where the key lives (`api_key`) and how their product reports errors
    (`read_error`). Everything else is shared."""

    def __init__(self) -> None:
        self._http: httpx.AsyncClient | None = None
        self._key_in_use: str | None = None

    # -- to override --
    def api_key(self) -> str | None:
        raise NotImplementedError

    def read_error(self, body: Any, status_code: int, text: str) -> TripJackError | None:
        """None when the response is a success."""
        raise NotImplementedError

    @property
    def configured(self) -> bool:
        return bool(self.api_key())

    def _client(self) -> httpx.AsyncClient:
        key = self.api_key()
        if not key:
            raise TripJackNotConfigured("TripJack API key is not set")
        if self._http is None or self._http.is_closed or key != self._key_in_use:
            self._http = httpx.AsyncClient(
                headers={
                    "apikey": key,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                timeout=httpx.Timeout(60.0, connect=5.0),
                limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
            )
            self._key_in_use = key
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _request(self, method: str, url: str, **kwargs: Any) -> Any:
        attempt = 0
        while True:
            try:
                response = await self._client().request(method, url, **kwargs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt < len(BACKOFF_SECONDS):
                    await asyncio.sleep(BACKOFF_SECONDS[attempt])
                    attempt += 1
                    continue
                raise TripJackError("TRANSPORT", str(exc) or exc.__class__.__name__) from exc

            if response.status_code == 429 and attempt < len(BACKOFF_SECONDS):
                wait = float(response.headers.get("Retry-After") or BACKOFF_SECONDS[attempt])
                await asyncio.sleep(min(wait, 10))
                attempt += 1
                continue
            try:
                body = response.json()
            except ValueError:
                body = None
            error = self.read_error(body, response.status_code, response.text)
            if error is None:
                return body
            if error.retryable and attempt < len(BACKOFF_SECONDS):
                await asyncio.sleep(BACKOFF_SECONDS[attempt])
                attempt += 1
                continue
            raise error
