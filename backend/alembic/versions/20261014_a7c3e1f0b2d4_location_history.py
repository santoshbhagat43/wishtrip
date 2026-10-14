"""location history

Revision ID: a7c3e1f0b2d4
Revises: 19e876438be3
Create Date: 2026-10-14 09:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'a7c3e1f0b2d4'
down_revision: str | None = '19e876438be3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A written history of a country or city (background, culture, what it's known for).
    op.add_column('locations', sa.Column('history', sa.Text(), server_default='', nullable=False))


def downgrade() -> None:
    op.drop_column('locations', 'history')
