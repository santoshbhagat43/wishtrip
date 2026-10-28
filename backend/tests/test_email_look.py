"""How the emails look: Wishtrip is written with a capital W and the rest small, and the logo is
inside the email."""

import re
from email import message_from_bytes

import pytest

from app.modules.emails import service
from app.modules.emails.copy import TEMPLATES

VARIABLES = {
    "first_name": "Riya", "code": "123456", "expires_minutes": "10", "approved_ago": "2 days",
    "bank_details_link": "https://x.example/b", "dashboard_link": "https://x.example/d",
}


def _prose(text: str) -> str:
    """The words a reader sees: no tags, no addresses (wishtrip.co is a domain, not the name)."""
    text = re.sub(r"<(style|title)[^>]*>.*?</\1>|<[^>]+>", " ", text, flags=re.S)
    return re.sub(r"[\w.+-]+@[\w.-]+|https?://\S+|www\.\S+|\bwishtrip\.co\b|wishtrip-logo", " ", text)


@pytest.mark.parametrize("name", sorted(TEMPLATES))
def test_the_name_is_wishtrip_everywhere_in_every_email(name):
    subject, body_html, body_text = service.render(name, **VARIABLES)
    for where, text in (("subject", subject), ("html", _prose(body_html)), ("text", _prose(body_text))):
        for word in re.findall(r"wish\s?trip", text, flags=re.I):
            assert word == "Wishtrip", f"{name} {where}: {word!r}"
    assert 'alt="Wishtrip' in body_html


def test_the_logo_is_sent_inside_the_email(monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, *a, **k): ...
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): ...
        def login(self, *a): ...
        def send_message(self, message): sent.append(message)

    monkeypatch.setattr(service.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(service.settings, "smtp_host", "smtp.example")
    monkeypatch.setattr(service.settings, "smtp_from", "Wishtrip <hello@wishtrip.co>")
    subject, body_html, body_text = service.render("sign-in-code", **VARIABLES)
    service.smtp_send("riya@example.com", subject, body_html, body_text)

    raw = message_from_bytes(sent[0].as_bytes())
    parts = list(raw.walk())
    image = next(p for p in parts if p.get_content_type() == "image/png")
    assert image["Content-ID"] == "<wishtrip-logo>" and len(image.get_payload(decode=True)) > 1000
    page = next(p for p in parts if p.get_content_type() == "text/html").get_payload(decode=True).decode()
    assert "cid:wishtrip-logo" in page and "/email/wishtrip-logo.png" not in page
