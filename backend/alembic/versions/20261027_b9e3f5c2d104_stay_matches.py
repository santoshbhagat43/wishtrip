"""which TripJack hotel a stay is: saved matches, and a name index for finding them

Revision ID: b9e3f5c2d104
Revises: a7d2e4b9c801
Create Date: 2026-10-27 10:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'b9e3f5c2d104'
down_revision: str | None = 'a7d2e4b9c801'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Typo-tolerant search over hotel names.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_supplier_hotels_name_trgm "
        "ON supplier_hotels USING gin (lower(name) gin_trgm_ops)"
    )
    op.create_table(
        'stay_matches',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('trip_id', sa.UUID(), nullable=False),
        sa.Column('item_id', sa.String(length=40), nullable=False),
        sa.Column('stay_name', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('hotel_id', sa.UUID(), nullable=True),
        sa.Column('score', sa.Float(), nullable=False, server_default='0'),
        sa.Column('state', sa.String(length=12), nullable=False, server_default='nomatch'),
        sa.Column('decided_by', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['creator_trips.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['hotel_id'], ['supplier_hotels.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('trip_id', 'item_id'),
    )
    op.create_index(op.f('ix_stay_matches_trip_id'), 'stay_matches', ['trip_id'])
    op.create_index(op.f('ix_stay_matches_hotel_id'), 'stay_matches', ['hotel_id'])
    op.create_index(op.f('ix_stay_matches_state'), 'stay_matches', ['state'])


def downgrade() -> None:
    for col in ('state', 'hotel_id', 'trip_id'):
        op.drop_index(op.f(f'ix_stay_matches_{col}'), table_name='stay_matches')
    op.drop_table('stay_matches')
    op.execute("DROP INDEX IF EXISTS ix_supplier_hotels_name_trgm")
