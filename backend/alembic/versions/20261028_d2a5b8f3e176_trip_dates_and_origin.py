"""a traveller's trip knows when it starts and where from

Revision ID: d2a5b8f3e176
Revises: c1f4a7e92d55
Create Date: 2026-10-28 16:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'd2a5b8f3e176'
down_revision: str | None = 'c1f4a7e92d55'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('traveller_trips', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('traveller_trips', sa.Column('origin_code', sa.String(length=3), nullable=False, server_default=''))
    op.add_column('traveller_trips', sa.Column('origin_city', sa.String(length=100), nullable=False, server_default=''))


def downgrade() -> None:
    for col in ('origin_city', 'origin_code', 'start_date'):
        op.drop_column('traveller_trips', col)
