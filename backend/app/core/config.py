from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The repo-root .env (shared with docker-compose) is read when running scripts from
    # backend/; a backend/.env, if present, overrides it. Real environment variables win over both.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_name: str = "WishTrip API"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://wishtrip:wishtrip@localhost:5433/wishtrip"
    redis_url: str = "redis://localhost:6381/0"
    cors_origins: list[str] = ["http://localhost:3001"]

    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 7

    media_root: str = "./media"
    media_url_prefix: str = "/media"
    max_upload_mb: int = 25

    # LLM for intent + planning: "ollama" (local), "openrouter" (online), "none" (KB-only
    # answers), or "auto" = openrouter when OPENROUTER_API_KEY is set, otherwise none.
    llm_provider: str = "auto"
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    chat_model: str = "x-ai/grok-4.7"
    intent_model: str = "x-ai/grok-4.3"
    ollama_chat_model: str = "gemma4"
    ollama_intent_model: str = "gemma4"
    # Intent extraction is structured and latency-sensitive: no thinking needed.
    intent_reasoning: str | None = "none"
    planner_reasoning: str | None = None
    # After the feasibility engine changes a plan, ask the planner to rewrite its reply to match
    # (one extra LLM call). Off = append a short "plan check" note instead.
    feasibility_rewrite: bool = True
    # Embeddings: "openrouter" (online), "ollama" (local), "hashing" (offline keyword fallback),
    # or "auto" = openrouter when OPENROUTER_API_KEY is set, otherwise hashing.
    embedding_provider: str = "auto"
    embedding_model: str = "google/gemini-embedding-2"
    ollama_base_url: str = "http://localhost:11434"
    ollama_embedding_model: str = "embeddinggemma-2"
    # Prefix queries/documents with EmbeddingGemma task prompts. None = on for embeddinggemma*.
    ollama_task_prompts: bool | None = None
    # Every provider is fitted to this size, so local (Ollama) and online (Gemini) vectors
    # share one column. 768 is native for EmbeddingGemma and a Matryoshka size for Gemini.
    embedding_dimensions: int = 768
    # Minimum cosine similarity for a knowledge-base hit to count; None = embedder default.
    retrieval_min_similarity: float | None = None

    # Run embedding jobs in-process instead of through Celery (tests, simple local runs).
    embeddings_inline: bool = False

    @property
    def ai_enabled(self) -> bool:
        """An OpenRouter key is configured (online embeddings/LLM available)."""
        return bool(self.openrouter_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
