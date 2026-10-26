"""Creator sign-in codes: the fallback while no provider is set up, and real codes once one is."""

import smtplib

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.auth import otp
from app.modules.creators.models import Creator
from app.modules.users.models import User


@pytest.fixture
def live_email(monkeypatch):
    """Email codes are live (SMTP configured); sent codes are captured instead of emailed."""
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_from", "WishTrip <login@wishtrip.test>")
    otp.set_store(otp.MemoryOtpStore())
    sent: list[tuple[str, str, str]] = []

    async def capture(channel, to, code):
        sent.append((channel, to, code))

    monkeypatch.setattr(otp, "deliver", capture)
    yield sent
    otp.set_store(None)


async def _request(client, **body):
    r = await client.post("/auth/creator/request-otp", json=body)
    assert r.status_code == 202, r.text


async def _verify(client, **body):
    return await client.post("/auth/creator/verify", json=body)


async def test_a_developers_opt_in_code_works_where_there_is_no_provider(client):
    # Only because the test environment opts in (CREATOR_DEV_OTP): the app has no hardcoded code.
    await _request(client, email="fallback@creators.example.com")
    r = await _verify(client, email="fallback@creators.example.com", code=settings.creator_dev_otp)
    assert r.status_code == 200


async def test_live_email_code_is_random_single_use_and_replaces_the_fixed_code(client, live_email):
    email = "live@creators.example.com"
    await _request(client, email=email)
    [(channel, to, code)] = live_email
    assert (channel, to) == ("email", email)
    assert len(code) == 6 and code.isdigit()

    # The fixed dev code no longer works once email is live.
    if code != settings.creator_dev_otp:
        r = await _verify(client, email=email, code=settings.creator_dev_otp)
        assert r.status_code == 400

    r = await _verify(client, email=email, code=code)
    assert r.status_code == 200, r.text
    # Single use: the same code can't sign in twice.
    r = await _verify(client, email=email, code=code)
    assert r.status_code == 400


async def test_too_many_wrong_guesses_burn_the_code(client, live_email):
    email = "guesser@creators.example.com"
    await _request(client, email=email)
    [(_, _, code)] = live_email
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(settings.otp_max_attempts):
        assert (await _verify(client, email=email, code=wrong)).status_code == 400
    # Even the right code is refused now; a new one must be requested.
    assert (await _verify(client, email=email, code=code)).status_code == 400


async def test_a_new_code_cannot_be_requested_inside_the_resend_window(client, live_email):
    email = "eager@creators.example.com"
    await _request(client, email=email)
    await _request(client, email=email)
    assert len(live_email) == 1


async def test_whatsapp_codes_only_go_to_numbers_a_creator_gave(client):
    await client.post(
        "/creators/apply",
        json={
            "email": "wa@creators.example.com",
            "name": "WA Creator",
            "handle": "wa.creator",
            "whatsapp": "+919876543210",
        },
    )
    async with SessionLocal() as session:
        creator = await session.scalar(
            select(Creator).where(Creator.email == "wa@creators.example.com")
        )
    assert creator.whatsapp == "+919876543210"

    # A number nobody applied with: same answer (no enumeration), but it can't sign in.
    await _request(client, channel="whatsapp", phone="+919800000000")
    r = await _verify(
        client, channel="whatsapp", phone="+919800000000", code=settings.creator_dev_otp
    )
    assert r.status_code == 400

    # The applicant's number signs in to their creator account.
    await _request(client, channel="whatsapp", phone="+919876543210")
    r = await _verify(
        client, channel="whatsapp", phone="+919876543210", code=settings.creator_dev_otp
    )
    assert r.status_code == 200, r.text
    me = await client.get(
        "/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}
    )
    assert me.json()["email"] == "wa@creators.example.com"
    assert me.json()["role"] == "creator"


async def test_a_number_already_used_by_another_creator_is_not_reassigned(client):
    for n, email in enumerate(("first@creators.example.com", "second@creators.example.com")):
        await client.post(
            "/creators/apply",
            json={"email": email, "name": "C", "handle": f"c.{n}", "whatsapp": "+447400123456"},
        )
    async with SessionLocal() as session:
        second = await session.scalar(
            select(Creator).where(Creator.email == "second@creators.example.com")
        )
    assert second.whatsapp is None
    assert "+447400123456" in second.notes


async def test_whatsapp_needs_an_international_number(client):
    r = await client.post(
        "/auth/creator/request-otp", json={"channel": "whatsapp", "phone": "98765"}
    )
    assert r.status_code == 422


async def test_google_sign_in_for_an_applied_creator_signs_in_as_that_creator(client, monkeypatch):
    from tests.test_google_auth import _configure, _id_token

    await client.post(
        "/creators/apply",
        json={
            "email": "gcreator@creators.example.com",
            "name": "G Creator",
            "youtube": "@gcreator",
        },
    )
    _configure(
        monkeypatch, {"id_token": _id_token(email="gcreator@creators.example.com", name="G")}
    )
    r = await client.post(
        "/auth/google/exchange", json={"code": "c", "redirect_uri": "http://localhost:3001/cb"}
    )
    assert r.status_code == 200, r.text

    async with SessionLocal() as session:
        user = await session.scalar(
            select(User).where(User.email == "gcreator@creators.example.com")
        )
        creator = await session.scalar(
            select(Creator).where(Creator.email == "gcreator@creators.example.com")
        )
    assert user.role == "creator"
    assert creator.user_id == user.id


def test_the_email_sender_speaks_smtp(monkeypatch):
    """The real sender, against a fake SMTP server: TLS, login, and a clear message."""
    calls = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            calls["server"] = (host, port)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self):
            calls["tls"] = True

        def login(self, user, password):
            calls["login"] = (user, password)

        def send_message(self, message):
            calls["message"] = message

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "smtp_host", "smtp.resend.com")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_username", "resend")
    monkeypatch.setattr(settings, "smtp_password", "secret")
    monkeypatch.setattr(settings, "smtp_from", "WishTrip <login@wishtrip.co>")

    otp._send_email("creator@example.com", "482913")

    assert calls["server"] == ("smtp.resend.com", 587)
    assert calls["tls"] and calls["login"] == ("resend", "secret")
    message = calls["message"]
    assert message["To"] == "creator@example.com"
    assert message["Subject"] == "482913 is your WishTrip sign-in code"
    assert "expires in 10 minutes" in message.get_body(("plain",)).get_content()
    page = message.get_body(("html",)).get_content()  # the same words, in the WishTrip template
    assert "482913" in page and "expires in 10 minutes</strong>" in page and "{{" not in page
