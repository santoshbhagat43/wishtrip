"""creator link itinerary

Revision ID: a27486e03295
Revises: 30df1ef6e9c0
Create Date: 2026-10-18 18:22:36.874938
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a27486e03295"
down_revision: str | None = "30df1ef6e9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("creator_links", sa.Column("youtube_url", sa.String(length=300), nullable=True))
    op.add_column("creator_links", sa.Column("import_id", sa.Uuid(), nullable=True))
    op.add_column(
        "creator_links",
        sa.Column("auto_publish", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_foreign_key(
        "fk_creator_links_import",
        "creator_links",
        "reel_imports",
        ["import_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_creator_links_import", "creator_links", type_="foreignkey")
    op.drop_column("creator_links", "auto_publish")
    op.drop_column("creator_links", "import_id")
    op.drop_column("creator_links", "youtube_url")
