"""a reel's voice-over keeps its times

Revision ID: f4d8c2b6a913
Revises: e3c7b1a9f402
Create Date: 2026-10-29 12:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'f4d8c2b6a913'
down_revision: str | None = 'e3c7b1a9f402'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'creator_content',
        sa.Column(
            'transcript_segments', postgresql.JSONB(astext_type=sa.Text()),
            server_default='[]', nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('creator_content', 'transcript_segments')
