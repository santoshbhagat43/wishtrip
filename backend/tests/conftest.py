import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://wishtrip:wishtrip@localhost:5433/wishtrip_test"
)
os.environ["EMBEDDINGS_INLINE"] = "true"
os.environ["EMBEDDING_PROVIDER"] = "hashing"
os.environ["LLM_PROVIDER"] = "auto"
os.environ["JWT_SECRET"] = "test-secret-that-is-at-least-32-bytes-long"
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["MEDIA_ROOT"] = "/tmp/wishtrip-test-media"
# Tests sign creators in with a fixed code. That is an explicit, test-only opt-in: there is no
# hardcoded default in the app, and it is ignored when ENVIRONMENT=production.
os.environ["CREATOR_DEV_OTP"] = "1234"

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.security import create_token, hash_password
from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.main import app
from app.modules.users.models import Role, User


@pytest.fixture(scope="session", autouse=True)
async def schema():
    async with engine.begin() as conn:
        # Start from an empty schema rather than Base.metadata.drop_all: drop_all removes the
        # circular-reference foreign keys by name and fails if this database was built before
        # one of them existed (a stale test database after pulling a schema change).
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean_tables():
    yield
    async with engine.begin() as conn:
        names = ", ".join(t.name for t in Base.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _user(role: Role, email: str) -> User:
    async with SessionLocal() as session:
        user = User(email=email, hashed_password=hash_password("password123"), role=role)
        session.add(user)
        await session.commit()
        return user


def auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_token(user.id, user.role, 'access')}"}


@pytest.fixture
async def admin() -> User:
    return await _user(Role.ADMIN, "admin@example.com")


@pytest.fixture
async def editor() -> User:
    return await _user(Role.EDITOR, "editor@example.com")


@pytest.fixture
async def traveler() -> User:
    return await _user(Role.TRAVELER, "traveler@example.com")


@pytest.fixture
async def support() -> User:
    return await _user(Role.SUPPORT, "support@example.com")


@pytest.fixture
async def london(client, editor):
    """A small published knowledge base: UK > London > three places."""
    h = auth(editor)
    tags = {}
    for name in ("Scenic views", "Street food", "History"):
        r = await client.post("/admin/tags", json={"name": name}, headers=h)
        tags[name] = r.json()["id"]
    uk = (
        await client.post(
            "/admin/locations",
            json={"type": "country", "name": "United Kingdom", "status": "published"},
            headers=h,
        )
    ).json()
    city = (
        await client.post(
            "/admin/locations",
            json={
                "type": "city",
                "name": "London",
                "parent_id": uk["id"],
                "status": "published",
                "summary": "Capital on the Thames",
            },
            headers=h,
        )
    ).json()
    places = {}
    for spec in (
        {
            "type": "attraction",
            "name": "Tower Bridge",
            "duration_minutes": 90,
            "energy_level": 2,
            "best_times": ["evening"],
            "couple_friendly": True,
            "summary": "Bridge with river views",
            "tag_ids": [tags["Scenic views"], tags["History"]],
        },
        {
            "type": "experience",
            "name": "Borough Market Food Walk",
            "duration_minutes": 120,
            "energy_level": 2,
            "summary": "Street food tasting at a historic market",
            "price_note": "Pay per stall",
            "tag_ids": [tags["Street food"]],
        },
        {
            "type": "activity",
            "name": "Thames Kayaking",
            "duration_minutes": 180,
            "energy_level": 5,
            "cost_level": 4,
            "family_friendly": False,
            "summary": "Paddle the river at sunrise",
        },
    ):
        r = await client.post(
            "/admin/locations",
            json={**spec, "parent_id": city["id"], "status": "published"},
            headers=h,
        )
        assert r.status_code == 201, r.text
        places[spec["name"]] = r.json()
    return {"uk": uk, "city": city, "places": places, "tags": tags}
