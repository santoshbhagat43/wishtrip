import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.ai.embeddings import get_embedder
from app.ai.llm import LLMClient
from app.core.config import settings
from app.db.session import engine
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.chat.router import router as chat_router
from app.modules.creators.creator_router import router as creator_router
from app.modules.creators.router import router as creators_router
from app.modules.explore.router import router as explore_router
from app.modules.flights.router import router as flights_router
from app.modules.hotels.router import router as hotels_router
from app.modules.insurance.router import router as insurance_router
from app.modules.knowledge.router import router as knowledge_router
from app.modules.media.router import router as media_router
from app.modules.menus.router import router as menus_router
from app.modules.profiles.router import router as profiles_router
from app.modules.recommendations.router import router as recommendations_router
from app.modules.reels.router import router as reels_router
from app.modules.search.router import router as search_router
from app.modules.support.router import router as support_router
from app.modules.tripjack.router import router as tripjack_router
from app.modules.users.router import router as users_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    auth_router,
    users_router,
    audit_router,
    knowledge_router,
    media_router,
    search_router,
    profiles_router,
    recommendations_router,
    explore_router,
    chat_router,
    reels_router,
    hotels_router,
    flights_router,
    insurance_router,
    tripjack_router,
    creators_router,
    creator_router,
    menus_router,
    support_router,
):
    app.include_router(router)

Path(settings.media_root).mkdir(parents=True, exist_ok=True)
app.mount(settings.media_url_prefix, StaticFiles(directory=settings.media_root), name="media")


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    """The API has no home page; send visitors to the interactive docs."""
    return RedirectResponse("/docs")


@app.get("/health", tags=["system"])
async def health() -> dict:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    llm = LLMClient()
    return {
        "status": "ok",
        "ai_enabled": llm.enabled,
        "llm_provider": llm.provider,
        "chat_model": llm.model_for("planner") if llm.enabled else None,
        "intent_model": llm.model_for("intent") if llm.enabled else None,
        "embedder": get_embedder().name,
    }
