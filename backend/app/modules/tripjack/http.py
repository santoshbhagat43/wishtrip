"""Shared HTTP plumbing for every TripJack product (hotels, flights, insurance): one pooled
client per product, the apikey header, and the retry rules TripJack documents."""

import asyncio
import logging
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from app.modules.tripjack import logs, trace

log = logging.getLogger(__name__)

BACKOFF_SECONDS = (1, 2, 4)
# The answer headers worth keeping in the record of a call.
KEPT_HEADERS = {"content-type", "content-length", "date", "retry-after", "request-id"}


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

    # Which product a call belongs to, for the record of calls (see trace.py).
    product = "tripjack"
    # How long to wait for one answer before giving up and retrying. Set per product from how long
    # its calls really take.
    timeout_seconds = 60.0

    # -- to override --
    def api_key(self) -> str | None:
        raise NotImplementedError

    def excerpt(self, url: str, body: Any) -> dict | None:
        """A compact copy of the values TripJack returned, kept as evidence. Never the key."""
        return None

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
                timeout=httpx.Timeout(self.timeout_seconds, connect=5.0),
                limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
            )
            self._key_in_use = key
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _request(self, method: str, url: str, **kwargs: Any) -> Any:
        """One call to TripJack, timed and recorded (the answer, or why there was none)."""
        started = time.monotonic()
        parsed = urlparse(url)
        call = trace.Call(
            product=self.product, method=method, host=parsed.netloc, path=parsed.path,
            status=None, ms=0, bytes=0, ok=False,
            request={"json": kwargs.get("json"), "params": kwargs.get("params")},
        )  # fmt: skip
        try:
            body = await self._send(method, url, call, **kwargs)
        except TripJackError as exc:
            call.error = f"{exc.code}: {exc.message}"[:300]
            raise
        else:
            call.ok = True
            try:
                call.excerpt = self.excerpt(url, body)
            except Exception:  # noqa: BLE001 - evidence is a nicety, never a failure
                log.warning("could not take an excerpt of %s", parsed.path, exc_info=True)
            return body
        finally:
            call.ms = int((time.monotonic() - started) * 1000)
            trace.record(call)
            await logs.save(call, self.api_key())

    async def _send(self, method: str, url: str, call: "trace.Call", **kwargs: Any) -> Any:
        attempt = 0
        while True:
            call.attempts = attempt + 1
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
            call.status, call.bytes = response.status_code, len(response.content)
            call.response_text = response.text
            call.response_headers = {
                k: v for k, v in response.headers.items() if k.lower() in KEPT_HEADERS
            }
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
