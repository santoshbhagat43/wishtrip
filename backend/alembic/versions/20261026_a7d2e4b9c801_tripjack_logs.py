"""the log of calls to TripJack

Revision ID: a7d2e4b9c801
Revises: a8c3e5d71f40
Create Date: 2026-10-26 14:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'a7d2e4b9c801'
down_revision: str | None = 'a8c3e5d71f40'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'tripjack_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('product', sa.String(length=16), nullable=False),
        sa.Column('method', sa.String(length=8), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=False),
        sa.Column('path', sa.String(length=300), nullable=False),
        sa.Column('request_headers', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('request_body', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('request_params', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.Integer(), nullable=True),
        sa.Column('response_headers', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('response_body', sa.Text(), nullable=False),
        sa.Column('response_bytes', sa.Integer(), nullable=False),
        sa.Column('response_truncated', sa.Boolean(), nullable=False),
        sa.Column('ms', sa.Integer(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('ok', sa.Boolean(), nullable=False),
        sa.Column('error', sa.String(length=400), nullable=False),
        sa.Column('trace_id', sa.String(length=32), nullable=False),
        sa.Column('environment', sa.String(length=48), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    for col in ('created_at', 'product', 'path', 'status', 'ok', 'trace_id'):
        op.create_index(op.f(f'ix_tripjack_logs_{col}'), 'tripjack_logs', [col])


def downgrade() -> None:
    for col in ('trace_id', 'ok', 'status', 'path', 'product', 'created_at'):
        op.drop_index(op.f(f'ix_tripjack_logs_{col}'), table_name='tripjack_logs')
    op.drop_table('tripjack_logs')
