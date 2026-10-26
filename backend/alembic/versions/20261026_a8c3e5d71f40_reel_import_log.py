"""reel imports keep a log of each stage

Revision ID: a8c3e5d71f40
Revises: f63c9e1a4d32
Create Date: 2026-10-26 11:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'a8c3e5d71f40'
down_revision: str | None = 'f63c9e1a4d32'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('reel_imports', sa.Column('log', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'))


def downgrade() -> None:
    op.drop_column('reel_imports', 'log')
