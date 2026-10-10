from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)


@event.listens_for(engine.sync_engine, "connect")
def _configure_vector_search(dbapi_connection, _record) -> None:
    """HNSW filters after the vector scan; iterative scans (pgvector >= 0.8) keep scanning
    until a filtered query (e.g. one city) has enough rows instead of returning too few."""
    cursor = dbapi_connection.cursor()
    cursor.execute("SET hnsw.iterative_scan = relaxed_order")
    cursor.close()


SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
