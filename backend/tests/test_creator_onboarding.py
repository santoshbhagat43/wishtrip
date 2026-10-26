"""The creator onboarding emails (application received, approved, rejected, bank details reminder,
account active) and the bank details they send."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.creators.models import Creator
from app.modules.emails import service as emails
from tests.conftest import auth

OTP = settings.creator_dev_otp or "1234"
BANK = {
    "holder": "Asha Rao",
    "bank_name": "HDFC Bank",
    "ifsc": "hdfc0001234",
    "account_number": "5010 0123 4567 89",
    "upi": "asha@okhdfc",
}


async def _sign_up(client, email: str) -> dict[str, str]:
    await client.post("/auth/creator/request-otp", json={"email": email})
    r = await client.post("/auth/creator/verify", json={"email": email, "code": OTP})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _me(client, headers) -> dict:
    return (await client.get("/creators/me", headers=headers)).json()


def names(outbox) -> list[str]:
    return [n for n, _, _ in outbox]


async def test_a_first_sign_in_and_an_application_are_each_acknowledged_once(client, outbox):
    headers = await _sign_up(client, "asha@creators.example.com")
    assert names(outbox) == ["application-received"]
    name, to, variables = outbox[0]
    assert to == "asha@creators.example.com" and variables["first_name"] == "Asha"
    await client.post("/auth/creator/verify", json={"email": "asha@creators.example.com", "code": OTP})
    assert names(outbox) == ["application-received"]  # signing in again says nothing more
    assert (await _me(client, headers))["status"] == "pending"

    applied = await client.post(
        "/creators/apply",
        json={"email": "meera@creators.example.com", "name": "Meera Kamat", "handle": "meera.k"},
    )
    assert applied.status_code == 202, applied.text
    assert names(outbox) == ["application-received", "application-received"]
    assert outbox[1][2]["first_name"] == "Meera"
    await client.post("/creators/apply", json={"email": "meera@creators.example.com", "name": "Meera Kamat"})
    assert len(outbox) == 2


async def test_approving_and_rejecting_send_their_emails(client, admin, outbox):
    headers = await _sign_up(client, "asha@creators.example.com")
    mine = await _me(client, headers)
    outbox.clear()

    r = await client.patch(f"/creators/{mine['id']}", json={"status": "active"}, headers=auth(admin))
    assert r.status_code == 200 and r.json()["onboarding"]["approved_at"]
    assert names(outbox) == ["approved"]
    assert outbox[0][2]["bank_details_link"].endswith("/profile#bank-details")

    # Pausing and re-activating is not a second approval.
    await client.patch(f"/creators/{mine['id']}", json={"status": "paused"}, headers=auth(admin))
    await client.patch(f"/creators/{mine['id']}", json={"status": "active"}, headers=auth(admin))
    assert names(outbox) == ["approved"]

    other = await _sign_up(client, "rohan@creators.example.com")
    rohan = await _me(client, other)
    outbox.clear()
    r = await client.patch(f"/creators/{rohan['id']}", json={"status": "rejected"}, headers=auth(admin))
    assert r.json()["status"] == "rejected" and r.json()["onboarding"]["rejected_at"]
    assert names(outbox) == ["rejected"] and outbox[0][1] == "rohan@creators.example.com"


async def test_a_rejected_creator_can_apply_again_only_after_the_cool_off(client, admin, outbox, monkeypatch):
    monkeypatch.setattr(settings, "creator_reapply_days", 90)
    headers = await _sign_up(client, "asha@creators.example.com")
    mine = await _me(client, headers)
    await client.patch(f"/creators/{mine['id']}", json={"status": "rejected"}, headers=auth(admin))
    outbox.clear()

    again = await client.post("/creators/apply", json={"email": "asha@creators.example.com", "name": "Asha", "handle": "asha.r"})
    assert again.status_code == 409 and "apply again from" in again.json()["detail"]
    assert outbox == []

    async with SessionLocal() as session:
        creator = await session.get(Creator, mine["id"])
        creator.rejected_at = datetime.now(UTC) - timedelta(days=91)
        await session.commit()
    again = await client.post("/creators/apply", json={"email": "asha@creators.example.com", "name": "Asha", "handle": "asha.r"})
    assert again.status_code == 202
    assert names(outbox) == ["application-received"]  # a fresh application is acknowledged again
    assert (await _me(client, headers))["status"] == "pending"


async def test_bank_details_reminder_then_details_then_confirmation(client, admin, outbox):
    headers = await _sign_up(client, "asha@creators.example.com")
    mine = await _me(client, headers)
    staff = auth(admin)

    # Not approved yet: no form, no reminder.
    assert (await client.put("/creators/me/bank-details", json=BANK, headers=headers)).status_code == 400
    assert (await client.post(f"/creators/{mine['id']}/bank-details/remind", headers=staff)).status_code == 400

    await client.patch(f"/creators/{mine['id']}", json={"status": "active"}, headers=staff)
    outbox.clear()
    async with SessionLocal() as session:  # approved three days ago
        creator = await session.get(Creator, mine["id"])
        creator.approved_at = datetime.now(UTC) - timedelta(days=3, hours=1)
        await session.commit()

    # Staff press "remind": the email carries how long it has been.
    r = await client.post(f"/creators/{mine['id']}/bank-details/remind", headers=staff)
    assert r.status_code == 200 and r.json()["onboarding"]["bank_reminder_sent_at"]
    assert names(outbox) == ["bank-details-reminder"]
    assert outbox[0][2]["approved_ago"] == "3 days ago" and outbox[0][2]["first_name"] == "Asha"

    # Nothing to confirm until they send details.
    assert (await client.post(f"/creators/{mine['id']}/bank-details/confirm", headers=staff)).status_code == 400
    assert (await client.get("/creators/me/bank-details", headers=headers)).json()["submitted"] is False

    # Bad details are explained; good ones are kept, and shown masked.
    for bad in ({"ifsc": "12345678901"}, {"account_number": "12ab56"}, {"upi": "no-at-sign"}):
        r = await client.put("/creators/me/bank-details", json={**BANK, **bad}, headers=headers)
        assert r.status_code == 400, bad
    r = await client.put("/creators/me/bank-details", json=BANK, headers=headers)
    assert r.status_code == 200
    saved = r.json()
    assert saved["submitted"] and saved["account_last4"] == "6789" and saved["ifsc"] == "HDFC0001234"
    assert "account_number" not in saved and "5010" not in r.text

    # Stored encrypted: the number is not in the database as typed.
    async with SessionLocal() as session:
        raw = (await session.execute(text("select bank_account_enc, bank_account_last4 from creators"))).one()
    assert "50100123456789" not in raw[0] and raw[0] and raw[1] == "6789"

    # Staff see the full number to pay it out; everything else about the creator stays masked.
    full = (await client.get(f"/creators/{mine['id']}/bank-details", headers=staff)).json()
    assert full["account_number"] == "50100123456789" and full["holder"] == "Asha Rao"
    detail = (await client.get(f"/creators/{mine['id']}", headers=staff)).json()
    assert detail["onboarding"]["bank"]["account_last4"] == "6789"
    assert "50100123456789" not in str(detail)
    assert (await client.get(f"/creators/{mine['id']}/bank-details", headers=headers)).status_code in (401, 403)

    # Confirm: the account is active, and the creator is told.
    outbox.clear()
    r = await client.post(f"/creators/{mine['id']}/bank-details/confirm", headers=staff)
    assert r.status_code == 200 and r.json()["onboarding"]["bank"]["confirmed_at"]
    assert names(outbox) == ["account-active"]
    assert outbox[0][2]["dashboard_link"].endswith("/")
    # …so no more reminders; and changing the details asks for a new confirmation.
    assert (await client.post(f"/creators/{mine['id']}/bank-details/remind", headers=staff)).status_code == 400
    await client.put("/creators/me/bank-details", json={**BANK, "bank_name": "ICICI Bank"}, headers=headers)
    assert (await client.get("/creators/me/bank-details", headers=headers)).json()["confirmed_at"] is None


async def test_the_staff_actions_are_staff_only(client, admin):
    headers = await _sign_up(client, "asha@creators.example.com")
    mine = await _me(client, headers)
    for path in ("remind", "confirm"):
        r = await client.post(f"/creators/{mine['id']}/bank-details/{path}", headers=headers)
        assert r.status_code in (401, 403)
    assert (await client.post(f"/creators/{mine['id']}/bank-details/remind")).status_code == 401


def test_every_template_renders_with_nothing_left_unfilled():
    for name in emails.TEMPLATES:
        subject, body_html, body_text = emails.render(
            name,
            first_name="Asha <b>",
            code="482913",
            expires_minutes=10,
            bank_details_link="https://creator.example/profile#bank-details",
            dashboard_link="https://creator.example/",
            approved_ago="3 days ago",
        )
        for part in (subject, body_html, body_text):
            assert "{{" not in part, (name, part[:80])
        assert "<b>" not in body_html  # values are escaped in the HTML…
    _, _, plain = emails.render("approved", first_name="Asha <b>", bank_details_link="x")
    assert "Asha <b>" in plain  # …and left alone in the plain text
    assert "wishtrip-logo.png" in emails.render("rejected", first_name="A")[1]


async def test_nothing_goes_out_for_creators_who_were_active_before_this_existed(client, admin, outbox):
    """The migration dates them as already approved and acknowledged: no surprise emails."""
    async with SessionLocal() as session:
        session.add(Creator(email="old@creators.example.com", status="active", referral_code="old",
                            application_emailed_at=datetime.now(UTC)))  # fmt: skip
        await session.commit()
        old = (await session.execute(select(Creator))).scalar_one()
    await client.patch(f"/creators/{old.id}", json={"display_name": "Old Hand"}, headers=auth(admin))
    assert outbox == []


def test_the_reminder_never_says_zero_days():
    for ago in ("today", "yesterday", "3 days ago"):
        _, body_html, body_text = emails.render(
            "bank-details-reminder", first_name="Asha", approved_ago=ago, bank_details_link="https://x/y"
        )
        assert f"approved {ago}" in body_text and f"approved <strong>{ago}</strong>" in body_html
        assert "0 days" not in body_text and "Add bank details" in body_text
    # Brand spelling in every email: Wishtrip, never WishTrip.
    for name in emails.TEMPLATES:
        subject, body_html, body_text = emails.render(name, first_name="A", code="1", expires_minutes=10)
        assert "WishTrip" not in subject + body_html + body_text, name
