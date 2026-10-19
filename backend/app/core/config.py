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

    # Google sign-in (SSO). The client_id is public; the client_secret stays on the server only.
    # The SSO app runs the browser redirect; the backend only exchanges the code for tokens.
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_token_url: str = "https://oauth2.googleapis.com/token"

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
    # A hung intent call must not stall the chat: give up and use keyword understanding.
    intent_timeout_seconds: float = 20
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

    # Reel imports: download (instaloader) → frames + OCR → transcript (Gemini) → places.
    # Run them in-process instead of on the Celery "media" queue (tests, simple local runs).
    reels_inline: bool = False
    # Audio transcription goes through OpenRouter; Gemini accepts mp3 input.
    reel_transcribe_model: str = "google/gemini-2.5-flash"
    reel_max_seconds: int = 180
    reel_max_frames: int = 60
    reel_download_timeout_seconds: int = 240
    reel_imports_per_hour: int = 10
    # Top a creator's itinerary up to a whole trip (at least two full days) from the knowledge
    # base and clearly-labelled AI suggestions. Off only for tests of the bare reading.
    complete_itineraries: bool = True
    reel_upload_max_mb: int = 120
    # A dedicated Instagram account's session (made once with `instaloader --login`). Keep it
    # outside MEDIA_ROOT: everything there is served publicly.
    # A Netscape-format cookies file from a signed-in YouTube session. Only needed if YouTube asks
    # the server to "confirm you're not a bot"; keep it somewhere private, never under MEDIA_ROOT.
    youtube_cookies_file: str | None = None
    # Send YouTube downloads through this proxy (e.g. http://user:pass@host:port). YouTube refuses
    # many data-centre addresses outright; a residential proxy needs no YouTube account.
    youtube_proxy: str | None = None
    # SaveAPI (api.saveapi.org): paid fallback when our own download of a reel/video fails.
    # Unset = no fallback. Keep the key server-side; every use is recorded in download_requests.
    saveapi_key: str | None = None
    saveapi_url: str = "https://api.saveapi.org"
    instagram_username: str | None = None
    instagram_session_file: str | None = None

    # Creator affiliates: a traveller is credited to the first creator who brought them in,
    # through a referral link at sign-up or a creator's reel within this many days of joining.
    referral_window_days: int = 30
    # What a creator earns per credited traveller who plans a trip. Staff set it per creator;
    # 0 = nothing agreed yet.
    creator_commission_per_user_paise: int = 0
    # Creator sign-in codes, by email or WhatsApp (app/modules/auth/otp.py). A channel sends real,
    # random, single-use codes as soon as its provider is configured. Until then it falls back to
    # this FIXED code — decided 2026-10-18 to keep creators able to sign in before a provider
    # exists. While a channel is on the fallback, anyone who knows a creator's email can sign in
    # as them. Configure SMTP (below) to close it for email.
    creator_dev_otp: str = "1234"
    otp_ttl_seconds: int = 600
    otp_max_attempts: int = 5
    otp_resend_seconds: int = 30
    # Email codes over SMTP — works with Resend, Amazon SES, Gmail or any SMTP service.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None  # e.g. "WishTrip <login@wishtrip.co>"
    smtp_starttls: bool = True

    # TripJack hotels (v3). The key is per environment and tied to whitelisted server IPs; keep it
    # server-side. Unset = hotel search is off. The defaults are the UAT (test) hosts; production
    # uses hms-search.tripjack.com / tripjack.com and needs certification first.
    tripjack_api_key: str | None = None
    tripjack_search_url: str = "https://apitest-hms.tripjack.com"
    tripjack_api_url: str = "https://apitest.tripjack.com"
    # Our margin on top of TripJack's price, in percent (10 = +10%). Applied to base price only;
    # taxes, management fee and its tax are passed through as TripJack sends them.
    tripjack_markup_percent: float = 0.0
    tripjack_currency: str = "INR"
    # TripJack countryId of the guest's nationality when the traveller has not said (106 = India).
    tripjack_nationality: str = "106"
    tripjack_request_timeout_ms: int = 13000
    # Repeat searches inside this window are served from Redis. Prices are live, so keep it short.
    tripjack_listing_cache_seconds: int = 180
    # Hotels sent to Listing per search, best-first (star rating, photos). Chunks of 100 run in
    # parallel.
    tripjack_search_hotels: int = 300

    # TripJack flights (v2) and TripSafe insurance share the apitest.tripjack.com host. Each key is
    # issued per product in the TripJack portal; unset = falls back to TRIPJACK_API_KEY.
    tripjack_flight_api_key: str | None = None
    tripjack_insurance_api_key: str | None = None
    # Our margin in percent: on the base fare (flights; taxes pass through) and on the total
    # premium (insurance).
    tripjack_flight_markup_percent: float = 0.0
    tripjack_insurance_markup_percent: float = 0.0
    # Searches repeated inside this window come from Redis. Flight priceIds live 15 minutes.
    tripjack_flight_cache_seconds: int = 300
    tripjack_insurance_cache_seconds: int = 600

    @property
    def ai_enabled(self) -> bool:
        """An OpenRouter key is configured (online embeddings/LLM available)."""
        return bool(self.openrouter_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
