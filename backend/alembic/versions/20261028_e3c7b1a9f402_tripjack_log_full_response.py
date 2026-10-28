"""a TripJack log row keeps the whole answer when it shows only part of it

Revision ID: e3c7b1a9f402
Revises: d2a5b8f3e176
Create Date: 2026-10-28 18:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'e3c7b1a9f402'
down_revision: str | None = 'd2a5b8f3e176'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('tripjack_logs', sa.Column('response_full', sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column('tripjack_logs', 'response_full')
