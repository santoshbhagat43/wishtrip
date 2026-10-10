from tests.conftest import auth


async def test_register_login_and_me(client):
    r = await client.post(
        "/auth/register", json={"email": "new@example.com", "password": "password123"}
    )
    assert r.status_code == 201
    r = await client.post(
        "/auth/login", json={"email": "NEW@example.com", "password": "password123"}
    )
    assert r.status_code == 200
    tokens = r.json()
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.json()["role"] == "traveler"

    refreshed = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    # An access token must not be accepted as a refresh token.
    bad = await client.post("/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert bad.status_code == 401


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
