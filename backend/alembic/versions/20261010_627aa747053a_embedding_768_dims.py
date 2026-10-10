"""embedding 768 dims

Revision ID: 627aa747053a
Revises: 91266727f8e3
Create Date: 2026-10-10 09:03:38.318614
"""
from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op


revision: str = '627aa747053a'
down_revision: str | None = '91266727f8e3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Vectors of a different size can't be converted; clear them so they are re-embedded.
    op.execute("DROP INDEX IF EXISTS ix_locations_embedding")
    op.execute(
        "ALTER TABLE locations ALTER COLUMN embedding TYPE vector(768) USING NULL"
    )
    op.execute("UPDATE locations SET embedded_at = NULL, embedding_model = NULL")
    op.execute(
        "CREATE INDEX ix_locations_embedding ON locations "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_locations_embedding")
    op.execute(
        "ALTER TABLE locations ALTER COLUMN embedding TYPE vector(1536) USING NULL"
    )
    op.execute("UPDATE locations SET embedded_at = NULL, embedding_model = NULL")
    op.execute(
        "CREATE INDEX ix_locations_embedding ON locations "
        "USING hnsw (embedding vector_cosine_ops)"
    )
