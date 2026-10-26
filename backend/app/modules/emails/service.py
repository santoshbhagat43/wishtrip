"""Send the transactional emails: render a template with its variables, then deliver it as
multipart/alternative (HTML plus plain text) over SMTP.

Sending never breaks the thing that triggered it: a failure is logged and `send` returns False."""

import asyncio
import html
import logging
import re
import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from functools import cache
from pathlib import Path

from app.core.config import settings
from app.modules.emails.copy import SUBJECTS, TEMPLATES, TEXTS

log = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent / "templates"
FILES = {
    "application-received": "01-application-received.html",
    "approved": "02-approved.html",
    "rejected": "03-rejected.html",
    "bank-details-reminder": "04-bank-details-reminder.html",
    "account-active": "05-account-active.html",
    "sign-in-code": "06-sign-in-code.html",
}
PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


class UnknownTemplate(KeyError):
    pass


@cache
def _html(name: str) -> str:
    return (TEMPLATE_DIR / FILES[name]).read_text(encoding="utf-8")


def common_variables() -> dict[str, str]:
    return {
        "logo_url": f"{settings.site_base}/email/wishtrip-logo.png",
        "support_email": settings.support_email,
        "current_year": str(datetime.now(UTC).year),
        "review_days": str(settings.creator_review_days),
        "reapply_days": str(settings.creator_reapply_days),
    }


def _fill(text: str, values: dict[str, str], escape: bool) -> str:
    def one(match: re.Match[str]) -> str:
        value = values.get(match.group(1))
        if value is None:
            return match.group(0)  # leave an unknown placeholder visible, never hide it
        return html.escape(value, quote=True) if escape else value

    return PLACEHOLDER.sub(one, text)


def render(name: str, **variables: object) -> tuple[str, str, str]:
    """(subject, html, plain text) for a template. Values are HTML-escaped in the HTML only."""
    if name not in TEMPLATES:
        raise UnknownTemplate(name)
    values = {**common_variables(), **{k: str(v) for k, v in variables.items()}}
    return (
        _fill(SUBJECTS[name], values, escape=False),
        _fill(_html(name), values, escape=True),
        _fill(TEXTS[name], values, escape=False),
    )


def configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def smtp_send(to: str, subject: str, body_html: str, body_text: str) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    name, address = parseaddr(settings.smtp_from or "")
    message["From"] = formataddr((name, address)) if address else settings.smtp_from
    message["To"] = to
    message["Reply-To"] = settings.support_email
    # Mail without a Date and a Message-ID is scored as spam; smtplib adds neither.
    message["Date"] = formatdate(localtime=False)
    domain = address.rsplit("@", 1)[-1] if "@" in address else None
    message["Message-ID"] = make_msgid(domain=domain)
    message.set_content(body_text)
    message.add_alternative(body_html, subtype="html")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)


def deliver_now(name: str, to: str, variables: dict[str, object]) -> bool:
    """Render and send one email, in this thread. False (and a log line) if it could not go."""
    if not configured():
        log.warning("email %s to %s not sent: no SMTP is configured", name, to)
        return False
    try:
        subject, body_html, body_text = render(name, **variables)
        smtp_send(to, subject, body_html, body_text)
    except Exception:
        log.exception("email %s to %s failed", name, to)
        return False
    return True


def _deliver(name: str, to: str, variables: dict[str, object]) -> None:
    if not settings.emails_via_worker:
        deliver_now(name, to, variables)
        return
    try:
        from app.workers.tasks import send_email_task

        send_email_task.delay(name, to, {k: str(v) for k, v in variables.items()})
    except Exception:  # the broker is down: the email is lost, what triggered it must not be
        log.exception("email %s to %s could not be queued", name, to)


# Swappable for tests, which capture the email instead of sending it.
deliver = _deliver


async def send(name: str, to: str | None, **variables: object) -> None:
    """Queue one email (to a worker, or in a thread when no worker is used)."""
    if not to:
        return
    await asyncio.to_thread(deliver, name, to, variables)
