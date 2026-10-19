"""Trustsignal (trustsignal.io): sends the sign-in code as an email. WhatsApp will follow.

    POST {trustsignal_email_url}/v1/otp-email?api_key=...
    {"to", "from", "template_id", "subject", "evariables": "<JSON string of template variables>"}

Success is `{"success": true, "results": {"email", "transaction_id", "ecost"}}`; a failure is
`{"success": false, "errors": [{"code", "codeMsg", "message"}]}`.

The API key is part of the URL (their design), so the log line httpx writes for every request
would contain it: `RedactApiKey` strips it from our logs. Our own errors never include the URL.
"""

import json
import logging
import re

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_KEY_IN_URL = re.compile(r"(api_key=)[^&\s\"')]+", re.IGNORECASE)


class RedactApiKey(logging.Filter):
    """Turns `?api_key=SECRET` into `?api_key=***` in anything logged (httpx logs each URL)."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if "api_key=" in message.lower():
            record.msg, record.args = _KEY_IN_URL.sub(r"\1***", message), None
        return True


for _name in ("httpx", "httpcore"):
    logging.getLogger(_name).addFilter(RedactApiKey())


class TrustsignalError(Exception):
    """Trustsignal did not send the message. `code` is theirs (or HTTP/TRANSPORT); the message is
    safe to log: it never contains the key."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"Trustsignal {code}: {message}")
        self.code = code
        self.message = message


def email_configured() -> bool:
    return bool(
        settings.trustsignal_api_key
        and settings.trustsignal_email_from
        and settings.trustsignal_email_template_id
    )


def _variables(code: str, to: str) -> str:
    """The template's variables, as the JSON string the API wants."""
    return json.dumps(
        {
            settings.trustsignal_otp_variable: code,
            "name": to.split("@")[0],
            "minutes": str(settings.otp_ttl_seconds // 60),
        }
    )


async def send_otp_email(to: str, code: str, client: httpx.AsyncClient | None = None) -> str:
    """Send the code; returns Trustsignal's transaction id."""
    body = {
        "to": to,
        "from": settings.trustsignal_email_from,
        "template_id": settings.trustsignal_email_template_id,
        "subject": settings.trustsignal_email_subject,
        "evariables": _variables(code, to),
    }
    url = f"{settings.trustsignal_email_url}/v1/otp-email"
    own = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
    try:
        response = await http.post(url, params={"api_key": settings.trustsignal_api_key}, json=body)
    except httpx.TimeoutException as exc:
        raise TrustsignalError("TIMEOUT", "Trustsignal did not answer in time") from exc
    except httpx.HTTPError as exc:
        raise TrustsignalError("TRANSPORT", exc.__class__.__name__) from exc
    finally:
        if own:
            await http.aclose()

    try:
        data = response.json()
    except ValueError:
        data = None
    if response.status_code == 200 and isinstance(data, dict) and data.get("success") is True:
        return str((data.get("results") or {}).get("transaction_id") or "")
    first = ((data or {}).get("errors") or [{}])[0] if isinstance(data, dict) else {}
    raise TrustsignalError(
        str(first.get("codeMsg") or first.get("code") or response.status_code),
        str(first.get("message") or (data or {}).get("message") or "request refused")[:200]
        if isinstance(data, dict)
        else "unreadable answer",
    )
