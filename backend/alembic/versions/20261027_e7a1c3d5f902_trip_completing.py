"""a creator trip being topped up in the background

Revision ID: e7a1c3d5f902
Revises: b9e3f5c2d104
Create Date: 2026-10-27 12:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'e7a1c3d5f902'
down_revision: str | None = 'b9e3f5c2d104'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'creator_trips',
        sa.Column('completing', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('creator_trips', 'completing')
