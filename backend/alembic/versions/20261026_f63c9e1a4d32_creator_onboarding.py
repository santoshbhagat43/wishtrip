"""creator onboarding: step dates, bank details

Revision ID: f63c9e1a4d32
Revises: e52b8d0f3c21
Create Date: 2026-10-26 10:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'f63c9e1a4d32'
down_revision: str | None = 'e52b8d0f3c21'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DATES = ['application_emailed_at', 'approved_at', 'rejected_at', 'bank_reminder_sent_at',
         'bank_confirmed_at', 'bank_submitted_at']


def upgrade() -> None:
    for name in DATES:
        op.add_column('creators', sa.Column(name, sa.DateTime(timezone=True), nullable=True))
    op.add_column('creators', sa.Column('bank_holder', sa.String(length=120), nullable=False, server_default=''))
    op.add_column('creators', sa.Column('bank_name', sa.String(length=120), nullable=False, server_default=''))
    op.add_column('creators', sa.Column('bank_ifsc', sa.String(length=16), nullable=False, server_default=''))
    op.add_column('creators', sa.Column('bank_account_enc', sa.Text(), nullable=False, server_default=''))
    op.add_column('creators', sa.Column('bank_account_last4', sa.String(length=4), nullable=False, server_default=''))
    op.add_column('creators', sa.Column('bank_upi', sa.String(length=100), nullable=False, server_default=''))
    # Creators who are already active were approved before this existed: keep them as they are
    # (no emails are sent for them), dated by when they joined.
    op.execute("UPDATE creators SET approved_at = created_at, application_emailed_at = created_at "
               "WHERE status IN ('active', 'paused')")
    op.execute("UPDATE creators SET application_emailed_at = created_at WHERE application_emailed_at IS NULL")


def downgrade() -> None:
    for name in ['bank_upi', 'bank_account_last4', 'bank_account_enc', 'bank_ifsc', 'bank_name', 'bank_holder']:
        op.drop_column('creators', name)
    for name in reversed(DATES):
        op.drop_column('creators', name)
