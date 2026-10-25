"""a reel thumbnail on each creator trip, separate from its cover

Revision ID: d41a7c9e2b10
Revises: b36ffb661f7a
Create Date: 2026-10-25 19:30:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'd41a7c9e2b10'
down_revision: str | None = 'b36ffb661f7a'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('creator_trips', sa.Column('thumbnail_image_key', sa.String(length=500), nullable=True))
    # Until a creator picks one, the thumbnail is the cover they already have.
    op.execute("UPDATE creator_trips SET thumbnail_image_key = cover_image_key")


def downgrade() -> None:
    op.drop_column('creator_trips', 'thumbnail_image_key')
