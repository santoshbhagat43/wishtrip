"""traveller trips are built for the party: persona, status, tips

Revision ID: c1f4a7e92d55
Revises: e7a1c3d5f902
Create Date: 2026-10-28 10:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'c1f4a7e92d55'
down_revision: str | None = 'e7a1c3d5f902'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('traveller_trips', sa.Column('source_import_id', sa.UUID(), nullable=True))
    op.create_foreign_key('traveller_trips_source_import_id_fkey', 'traveller_trips', 'reel_imports',
                          ['source_import_id'], ['id'], ondelete='SET NULL')
    op.create_index(op.f('ix_traveller_trips_source_import_id'), 'traveller_trips', ['source_import_id'])
    op.add_column('traveller_trips', sa.Column('source_items', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'))
    op.add_column('traveller_trips', sa.Column('persona', sa.String(length=16), nullable=False, server_default=''))
    op.add_column('traveller_trips', sa.Column('group', sa.String(length=16), nullable=False, server_default=''))
    op.add_column('traveller_trips', sa.Column('build_status', sa.String(length=10), nullable=False, server_default='ready'))
    op.add_column('traveller_trips', sa.Column('build_error', sa.String(length=300), nullable=False, server_default=''))
    op.add_column('traveller_trips', sa.Column('ai_built', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('traveller_trips', sa.Column('plan_summary', sa.Text(), nullable=False, server_default=''))
    op.add_column('traveller_trips', sa.Column('tips', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'))
    # Trips made before this keep the stops they were copied with.
    op.execute("UPDATE traveller_trips SET source_items = items")


def downgrade() -> None:
    for col in ('tips', 'plan_summary', 'ai_built', 'build_error', 'build_status', 'group', 'persona', 'source_items'):
        op.drop_column('traveller_trips', col)
    op.drop_index(op.f('ix_traveller_trips_source_import_id'), table_name='traveller_trips')
    op.drop_constraint('traveller_trips_source_import_id_fkey', 'traveller_trips', type_='foreignkey')
    op.drop_column('traveller_trips', 'source_import_id')
