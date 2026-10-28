"""An applicant is a registered creator from the moment they apply: signing in finds them, and
approval only changes what they may do. Staff can delete a creator entirely to test again."""

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.modules.audit.models import AuditLog
from app.modules.creators.models import Creator
from app.modules.users.models import Role, User
from tests.conftest import auth, sign_up

APPLY = {"name": "Maya Rao", "handle": "maya.rao"}


async def _creator(email: str) -> Creator | None:
    async with SessionLocal() as session:
        return await session.scalar(select(Creator).where(func.lower(Creator.email) == email))


async def _user(email: str) -> User | None:
    async with SessionLocal() as session:
        return await session.scalar(select(User).where(func.lower(User.email) == email))


async def _token(client, email: str) -> dict[str, str]:
    r = await sign_up(client, email)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_applying_registers_the_creator_before_anyone_approves_them(client, admin):
    email = "maya@creators.example.com"
    assert (await client.post("/creators/apply", json={"email": email, **APPLY})).status_code == 202
    creator, user = await _creator(email), await _user(email)
    assert creator and user and user.role == Role.CREATOR and creator.user_id == user.id

    # Signing in through the ordinary sign-in page finds them as a creator, waiting for approval.
    headers = await _token(client, email)
    me = await client.get("/creators/me", headers=headers)
    assert me.status_code == 200 and me.json()["status"] == "pending"

    # Approval is what changes: the same account, now active.
    await client.patch(f"/creators/{creator.id}", json={"status": "active"}, headers=auth(admin))
    assert (await client.get("/creators/me", headers=headers)).json()["status"] == "active"


async def test_a_traveller_who_applies_keeps_their_account_and_becomes_a_creator(client):
    email = "ravi@example.com"
    headers = await _token(client, email)  # signs up as a traveller first
    before = await _user(email)
    assert before and before.role == Role.TRAVELER
    assert (await client.get("/creators/me", headers=headers)).status_code == 404

    await client.post("/creators/apply", json={"email": email, "name": "Ravi", "handle": "ravi.k"})
    after = await _user(email)
    assert after and after.id == before.id and after.role == Role.CREATOR
    assert (await client.get("/creators/me", headers=headers)).status_code == 200


async def test_an_applicant_left_unlinked_by_the_old_flow_is_linked_when_they_sign_in(client):
    email = "old@example.com"
    await _token(client, email)  # a traveller account
    async with SessionLocal() as session:  # a creator row from before accounts were made at apply
        session.add(Creator(email=email, display_name="Old", referral_code="oldcode"))
        await session.commit()
    headers = await _token(client, email)
    assert (await client.get("/creators/me", headers=headers)).status_code == 200


async def test_a_team_email_cannot_apply_as_a_creator(client, admin):
    r = await client.post("/creators/apply", json={"email": admin.email, **APPLY})
    assert r.status_code == 409
    assert (await _user(admin.email)).role == Role.ADMIN


async def test_admin_deletes_a_creator_entirely_and_the_email_can_start_again(
    client, admin, traveler
):
    email = "test1@creators.example.com"
    await client.post("/creators/apply", json={"email": email, **APPLY})
    creator = await _creator(email)
    assert creator

    assert (
        await client.delete(f"/creators/{creator.id}", headers=auth(traveler))
    ).status_code == 403
    gone = await client.delete(f"/creators/{creator.id}", headers=auth(admin))
    assert gone.status_code == 204
    assert await _creator(email) is None and await _user(email) is None
    assert (await client.delete(f"/creators/{creator.id}", headers=auth(admin))).status_code == 404

    async with SessionLocal() as session:
        entry = await session.scalar(select(AuditLog).where(AuditLog.entity_type == "creator"))
    assert entry and entry.action == "delete" and entry.changes["email"] == email

    # The same address applies afresh, as if it never had.
    again = await client.post("/creators/apply", json={"email": email, **APPLY})
    assert again.status_code == 202
    assert (await _creator(email)).status.value == "pending"
