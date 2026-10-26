"""traveller trips: a creator's trip made the traveller's own

Revision ID: e52b8d0f3c21
Revises: d41a7c9e2b10
Create Date: 2026-10-25 21:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'e52b8d0f3c21'
down_revision: str | None = 'd41a7c9e2b10'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'traveller_trips',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('code', sa.String(length=16), nullable=False),
        sa.Column('source_trip_id', sa.UUID(), nullable=True),
        sa.Column('source_share_code', sa.String(length=64), nullable=False, server_default=''),
        sa.Column('title', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('destination_name', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('summary', sa.Text(), nullable=False, server_default=''),
        sa.Column('cover_image_key', sa.String(length=500), nullable=True),
        sa.Column('creator_name', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('creator_handle', sa.String(length=100), nullable=True),
        sa.Column('creator_referral_code', sa.String(length=64), nullable=False, server_default=''),
        sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('adults', sa.Integer(), nullable=False, server_default='2'),
        sa.Column('kids', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('seniors', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('days', sa.Integer(), nullable=False, server_default='4'),
        sa.Column('pace', sa.String(length=16), nullable=False, server_default='relaxed'),
        sa.Column('when_text', sa.String(length=80), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['source_trip_id'], ['creator_trips.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
    )
    op.create_index(op.f('ix_traveller_trips_source_trip_id'), 'traveller_trips', ['source_trip_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_traveller_trips_source_trip_id'), table_name='traveller_trips')
    op.drop_table('traveller_trips')
