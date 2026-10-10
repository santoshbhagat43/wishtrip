"""Import every model so Alembic and metadata.create_all see the full schema."""

from app.db.base import Base
from app.modules.audit.models import AuditLog
from app.modules.chat.models import ChatMessage, ChatSession
from app.modules.knowledge.models import Location, LocationRelation, Tag, location_tags
from app.modules.media.models import Media
from app.modules.profiles.models import ProfileEvent, TravelerProfile
from app.modules.users.models import User

__all__ = [
    "AuditLog",
    "Base",
    "ChatMessage",
    "ChatSession",
    "Location",
    "LocationRelation",
    "Media",
    "ProfileEvent",
    "Tag",
    "TravelerProfile",
    "User",
    "location_tags",
]
