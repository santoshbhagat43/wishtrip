from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.creators.models import Creator
from app.modules.users.models import User
from tests.conftest import auth, sign_up


async def test_a_traveller_signs_up_and_in_with_a_code_and_refreshes(client):
    r = await sign_up(client, "New@Example.com")
    assert r.status_code == 200, r.text
    tokens = r.json()
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.json()["role"] == "traveler" and me.json()["email"] == "new@example.com"

    # Signing in again is the same account, not a second one.
    again = await sign_up(client, "new@example.com")
    assert again.status_code == 200
    users = await client.get("/admin/users")  # unauthenticated: just proving the route is closed
    assert users.status_code == 401

    refreshed = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    # An access token must not be accepted as a refresh token.
    bad = await client.post("/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert bad.status_code == 401


async def test_there_is_no_password_sign_up(client):
    r = await client.post(
        "/auth/register", json={"email": "pw@example.com", "password": "password123"}
    )
    assert r.status_code in (404, 405)


async def test_a_wrong_code_does_not_sign_anyone_in(client):
    await client.post("/auth/otp/request", json={"email": "x@example.com"})
    r = await client.post("/auth/otp/verify", json={"email": "x@example.com", "code": "999999"})
    assert r.status_code == 400
    async with SessionLocal() as session:
        assert await session.scalar(select(User).where(User.email == "x@example.com")) is None


async def test_a_team_account_cannot_sign_in_with_a_code(client, admin):
    r = await sign_up(client, admin.email)
    assert r.status_code == 403


async def test_a_disabled_traveller_cannot_sign_in_with_a_code(client, admin, traveler):
    await client.patch(
        f"/admin/users/{traveler.id}", json={"is_active": False}, headers=auth(admin)
    )
    assert (await sign_up(client, traveler.email)).status_code == 403


async def test_a_traveller_who_signs_in_as_a_creator_becomes_one_keeping_their_account(
    client, traveler
):
    r = await client.post("/auth/creator/request-otp", json={"email": traveler.email})
    assert r.status_code == 202
    r = await client.post(
        "/auth/creator/verify", json={"email": traveler.email, "code": settings.creator_dev_otp}
    )
    assert r.status_code == 200, r.text
    me = await client.get(
        "/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}
    )
    assert me.json()["id"] == str(traveler.id) and me.json()["role"] == "creator"
    async with SessionLocal() as session:
        creator = await session.scalar(select(Creator).where(Creator.user_id == traveler.id))
        assert creator is not None
    # And the same person can still sign in as a traveller afterwards.
    assert (await sign_up(client, traveler.email)).status_code == 200


async def test_a_team_account_cannot_become_a_creator(client, admin):
    r = await client.post(
        "/auth/creator/verify", json={"email": admin.email, "code": settings.creator_dev_otp}
    )
    assert r.status_code == 409


async def test_wrong_password(client, traveler):
    r = await client.post("/auth/login", json={"email": traveler.email, "password": "nope-nope"})
    assert r.status_code == 401


async def test_roles(client, admin, editor, traveler):
    assert (await client.get("/admin/users", headers=auth(admin))).status_code == 200
    assert (await client.get("/admin/users", headers=auth(editor))).status_code == 403
    assert (await client.get("/admin/locations", headers=auth(traveler))).status_code == 403
    assert (await client.get("/admin/locations")).status_code == 401


async def test_login_accepts_local_test_domain(client):
    from app.core.security import hash_password
    from app.db.session import SessionLocal
    from app.modules.users.models import Role, User

    async with SessionLocal() as session:
        session.add(
            User(
                email="admin@wishtrip.test",
                hashed_password=hash_password("password123"),
                role=Role.ADMIN,
            )
        )
        await session.commit()
    r = await client.post(
        "/auth/login", json={"email": "admin@wishtrip.test", "password": "password123"}
    )
    assert r.status_code == 200


async def test_expired_tampered_and_wrong_type_tokens_are_rejected(client, traveler):
    from datetime import UTC, datetime, timedelta

    import jwt

    from app.core.config import settings
    from app.core.security import create_token

    expired = jwt.encode(
        {
            "sub": str(traveler.id),
            "role": "traveler",
            "type": "access",
            "exp": datetime.now(UTC) - timedelta(minutes=1),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    good = create_token(traveler.id, "traveler", "access")
    tampered = good[:-4] + ("AAAA" if not good.endswith("AAAA") else "BBBB")
    refresh_as_access = create_token(traveler.id, "traveler", "refresh")
    for token in (expired, tampered, refresh_as_access, "not-a-jwt"):
        r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401, token
    assert (
        await client.get("/auth/me", headers={"Authorization": f"Bearer {good}"})
    ).status_code == 200


async def test_disabled_accounts_lose_access_immediately(client, admin, traveler):
    from tests.conftest import auth

    await client.patch(
        f"/admin/users/{traveler.id}", json={"is_active": False}, headers=auth(admin)
    )
    assert (await client.get("/auth/me", headers=auth(traveler))).status_code == 401
    login = await client.post(
        "/auth/login", json={"email": traveler.email, "password": "password123"}
    )
    assert login.status_code == 401


async def test_role_is_read_from_the_database_not_the_token(client, traveler):
    """A token claiming 'admin' for a traveler account must not grant admin access."""
    from app.core.security import create_token

    forged_role = create_token(traveler.id, "admin", "access")
    r = await client.get("/admin/users", headers={"Authorization": f"Bearer {forged_role}"})
    assert r.status_code == 403


async def test_api_root_redirects_to_docs(client):
    r = await client.get("/", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/docs"
