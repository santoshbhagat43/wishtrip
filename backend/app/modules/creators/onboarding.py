"""A creator's onboarding emails, and the bank details they send us.

  applied   → application received (01)
  approved  → welcome, add bank details (02)       rejected → an update, apply again later (03)
  nudge     → bank details reminder (04, staff press a button; N days after approval)
  confirmed → account active (05)
"""

import re
from datetime import UTC, datetime

from app.core import secrets
from app.core.config import settings
from app.core.errors import bad_request
from app.modules.creators.models import Creator, CreatorStatus
from app.modules.creators.schemas import BankDetailsIn
from app.modules.emails import service as emails


def _now() -> datetime:
    return datetime.now(UTC)


def first_name(creator: Creator) -> str:
    name = (creator.display_name or "").strip() or (creator.handle or "").strip()
    if not name and creator.email:
        name = re.split(r"[._+\-0-9]", creator.email.split("@")[0])[0].title()
    return (name.split() or ["there"])[0]


def bank_link() -> str:
    return f"{settings.creator_base}/profile#bank-details"


def dashboard_link() -> str:
    return f"{settings.creator_base}/"


async def application_received(creator: Creator) -> None:
    """Once, when someone first applies (the form or a first sign-in)."""
    if creator.application_emailed_at or creator.status != CreatorStatus.PENDING:
        return
    creator.application_emailed_at = _now()
    await emails.send("application-received", creator.email, first_name=first_name(creator))


async def approved(creator: Creator) -> None:
    creator.approved_at = _now()
    creator.rejected_at = None
    await emails.send(
        "approved", creator.email, first_name=first_name(creator), bank_details_link=bank_link()
    )


async def rejected(creator: Creator) -> None:
    creator.rejected_at = _now()
    await emails.send("rejected", creator.email, first_name=first_name(creator))


def _need_email(creator: Creator) -> None:
    if not creator.email:
        raise bad_request("This creator has no email address to write to.")


async def remind_bank_details(creator: Creator) -> None:
    _need_email(creator)
    if creator.status != CreatorStatus.ACTIVE:
        raise bad_request("Only an approved creator can be asked for bank details.")
    if creator.bank_confirmed_at:
        raise bad_request("Their bank details are already confirmed.")
    since = creator.approved_at or creator.created_at
    days = max(0, (_now() - since).days)
    creator.bank_reminder_sent_at = _now()
    await emails.send(
        "bank-details-reminder",
        creator.email,
        first_name=first_name(creator),
        days_since_approval=days,
        bank_details_link=bank_link(),
    )


async def confirm_bank_details(creator: Creator) -> None:
    _need_email(creator)
    if creator.status != CreatorStatus.ACTIVE:
        raise bad_request("Only an approved creator has bank details to confirm.")
    if not creator.bank_submitted_at:
        raise bad_request("They haven't sent bank details yet.")
    creator.bank_confirmed_at = _now()
    await emails.send(
        "account-active",
        creator.email,
        first_name=first_name(creator),
        dashboard_link=dashboard_link(),
    )


IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
UPI = re.compile(r"^[\w.\-]{2,}@[A-Za-z]{2,}$")


def save_bank_details(creator: Creator, data: BankDetailsIn) -> None:
    """Keep what the creator sent. Changing details after staff confirmed them asks for a new
    confirmation, since the account to pay has changed."""
    holder = " ".join(data.holder.split())
    ifsc = data.ifsc.strip().upper()
    number = re.sub(r"[\s-]", "", data.account_number)
    upi = data.upi.strip()
    if not IFSC.match(ifsc):
        raise bad_request("That IFSC code doesn't look right (like HDFC0001234).")
    if not number.isdigit() or not 6 <= len(number) <= 20:
        raise bad_request("Enter the account number using digits only (6 to 20 of them).")
    if upi and not UPI.match(upi):
        raise bad_request("That UPI id doesn't look right (like name@bank).")
    creator.bank_holder = holder
    creator.bank_name = " ".join(data.bank_name.split())
    creator.bank_ifsc = ifsc
    creator.bank_account_enc = secrets.encrypt(number)
    creator.bank_account_last4 = number[-4:]
    creator.bank_upi = upi
    creator.bank_submitted_at = _now()
    creator.bank_confirmed_at = None


def account_number(creator: Creator) -> str:
    return secrets.decrypt(creator.bank_account_enc)
