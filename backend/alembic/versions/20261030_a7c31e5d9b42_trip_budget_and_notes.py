"""traveller trips: the budget and notes from the Details screen

Revision ID: a7c31e5d9b42
Revises: f8b349a827e3
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7c31e5d9b42"
down_revision: str | None = "f8b349a827e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "traveller_trips", sa.Column("budget", sa.String(16), nullable=False, server_default="")
    )
    op.add_column(
        "traveller_trips", sa.Column("notes", sa.String(300), nullable=False, server_default="")
    )


def downgrade() -> None:
    op.drop_column("traveller_trips", "notes")
    op.drop_column("traveller_trips", "budget")
