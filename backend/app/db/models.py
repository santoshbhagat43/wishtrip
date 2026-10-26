"""Import every model so Alembic and metadata.create_all see the full schema."""

from app.db.base import Base
from app.modules.audit.models import AuditLog
from app.modules.chat.models import ChatMessage, ChatSession
from app.modules.creators.models import (
    CommissionEntry,
    Creator,
    CreatorAttribution,
    CreatorLink,
    CreatorTrip,
    TravellerTrip,
)
from app.modules.hotels.models import StayMatch, SupplierHotel, SupplierRegion
from app.modules.knowledge.models import Location, LocationRelation, Tag, location_tags
from app.modules.media.models import Media
from app.modules.menus.models import MenuGroup, MenuItem
from app.modules.profiles.models import ProfileEvent, TravelerProfile
from app.modules.reels.models import CreatorContent, DownloadRequest, ReelImport
from app.modules.support.models import (
    AgentRouting,
    SupportMessage,
    SupportRouting,
    SupportTicket,
    TicketAssignment,
)
from app.modules.tripjack.models import TripJackLog
from app.modules.users.models import User

__all__ = [
    "AgentRouting",
    "AuditLog",
    "Base",
    "ChatMessage",
    "ChatSession",
    "CommissionEntry",
    "Creator",
    "CreatorAttribution",
    "CreatorLink",
    "CreatorContent",
    "CreatorTrip",
    "Location",
    "LocationRelation",
    "Media",
    "MenuGroup",
    "MenuItem",
    "ProfileEvent",
    "DownloadRequest",
    "ReelImport",
    "StayMatch",
    "SupplierHotel",
    "SupplierRegion",
    "SupportMessage",
    "SupportRouting",
    "SupportTicket",
    "TicketAssignment",
    "Tag",
    "TravelerProfile",
    "TravellerTrip",
    "TripJackLog",
    "User",
    "location_tags",
]
