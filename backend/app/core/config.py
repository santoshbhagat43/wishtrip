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
    # Key for the bank account numbers kept encrypted; falls back to jwt_secret when unset.
    bank_encryption_key: str | None = None
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
    # "Build my trip" writes a whole itinerary in one go. It does not need long thinking, which is
    # most of the wait; None for the model = the same one as the chat.
    trip_build_model: str | None = None
    trip_build_reasoning: str | None = "none"
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
    # At most this many of those frames are read by OCR, spread over the whole video (after
    # repeated screens are dropped). OCR is the slow part on a small server: about a second a
    # frame per core. 0 = read them all.
    reel_ocr_max_frames: int = 30
    # Frames kept from each video for the creator to choose a cover from (0 = keep none).
    reel_cover_frames: int = 12
    # Frames read by OCR at the same time. 0 = one per CPU. Tesseract is single-threaded per
    # frame here (OMP_THREAD_LIMIT=1), so this is what uses the machine's cores.
    reel_ocr_workers: int = 0
    reel_download_timeout_seconds: int = 240
    reel_imports_per_hour: int = 10
    # Trips built with AI for travellers, across everyone, per hour. Past it, trips are arranged by
    # rule (no AI) so the cost stays bounded; nobody is refused.
    trip_builds_per_hour: int = 120
    # Top a creator's itinerary up to a whole trip (at least two full days) from the knowledge
    # base and clearly-labelled AI suggestions. Off only for tests of the bare reading.
    complete_itineraries: bool = True
    # When the video's own places already make a trip of two days or more, show the creator
    # those at once and add the rest in the background (a worker), instead of making them wait.
    complete_trips_in_background: bool = True
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
    # Instagram reels come from SaveAPI only (about 2 s, no Instagram login needed); false = our
    # own instaloader first, SaveAPI as its fallback. Without a key, instaloader is used either way.
    instagram_via_saveapi: bool = True
    instagram_username: str | None = None
    instagram_session_file: str | None = None

    # Creator affiliates: a traveller is credited to the first creator who brought them in,
    # through a referral link at sign-up or a creator's reel within this many days of joining.
    referral_window_days: int = 30
    # What a creator earns per credited traveller who plans a trip. Staff set it per creator;
    # 0 = nothing agreed yet.
    creator_commission_per_user_paise: int = 0
    # Creator sign-in codes, by email (and later WhatsApp): app/modules/auth/otp.py. A code is six
    # random digits, single-use, sent through Trustsignal (below).
    #
    # HARDCODED FIXED CODE: DISABLED. It used to be `creator_dev_otp: str = "1234"`, the code every
    # creator could sign in with while no provider existed (anyone who knew a creator's email could
    # sign in as them). It is no longer a default. It exists only if a developer sets
    # CREATOR_DEV_OTP in a local .env, and is ignored whenever ENVIRONMENT=production.
    # creator_dev_otp: str = "1234"
    creator_dev_otp: str | None = None
    # TEMPORARY, for a test server (UAT) with no email provider yet: let CREATOR_DEV_OTP work even
    # when ENVIRONMENT=production. It only applies while no email provider is configured: the
    # moment Trustsignal (or SMTP) is set up, real codes take over and the fixed one stops working.
    # Anyone who knows an email can sign in as that traveller/creator while it is on.
    allow_fixed_otp_in_production: bool = False
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

    # Trustsignal (trustsignal.io): sends the sign-in code by email today, WhatsApp later. Email is
    # live once the key, the sender and the template are set. The key travels in the request URL
    # (their API's way), so it is redacted from our logs; keep it server-side.
    trustsignal_api_key: str | None = None
    trustsignal_email_url: str = "https://eapi.trustsignal.io"
    # A sender address verified in the Trustsignal account, e.g. "login@wishtrip.co".
    trustsignal_email_from: str | None = None
    # The OTP email template made in the Trustsignal account.
    trustsignal_email_template_id: str | None = None
    trustsignal_email_subject: str = "Your WishTrip sign-in code"
    # The name of the template variable that holds the code ({{otp}} in the template).
    trustsignal_otp_variable: str = "otp"

    # Transactional email (creator onboarding and sign-in codes: app/modules/emails).
    # The public addresses of the traveller website and the creator site, for links and the logo;
    # on a server they come from WEBSITE_DOMAIN / CREATOR_DOMAIN (the same .env as Caddy's).
    website_url: str | None = None
    creator_url: str | None = None
    website_domain: str | None = None
    creator_domain: str | None = None
    support_email: str = "support@wishtrip.co"
    # Timing promised in the emails: configurable, never baked into the copy.
    creator_review_days: int = 5
    creator_reapply_days: int = 90
    creator_bank_reminder_days: int = 3
    # Send the emails through Celery (a worker must be running); false = in the request's thread.
    emails_via_worker: bool = True

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
    # FOR LOCAL TESTING ONLY. TripJack answers only from the whitelisted server address, so a laptop
    # can send its TripJack calls through an SSH tunnel to the server (deploy/tripjack-tunnel.sh),
    # e.g. TRIPJACK_PROXY=socks5://host.docker.internal:1080. Empty = off (the default). It is
    # ignored when ENVIRONMENT=production, so it can never reroute the server's own calls.
    tripjack_proxy: str | None = None
    # The record of every TripJack call (request and answer) is kept this many days.
    tripjack_log_days: int = 14
    # Longest answer kept whole, in bytes (a hotel listing can be megabytes). Catalogue-sync answers
    # (content/…) keep only their first few KB.
    tripjack_log_body_bytes: int = 200_000
    tripjack_log_sync_bytes: int = 3_000
    # An answer cut for the log is also kept whole (compressed) up to this size, so staff can open
    # or download all of it. The catalogue sync's answers are not: there are thousands of them.
    tripjack_log_full_bytes: int = 30_000_000
    # Repeat searches inside this window are served from Redis. Prices are live, so keep it short.
    tripjack_listing_cache_seconds: int = 180
    # Hotels sent to Listing per search, best-first (star rating, photos). Chunks of 100 run in
    # parallel.
    tripjack_search_hotels: int = 300
    # Use TripJack hotel photos as the picture of a destination that has no creator trip cover.
    # They are credited by hotel name; turn this off if the photo terms don't allow it.
    destination_hotel_photos: bool = True

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
    def site_base(self) -> str:
        if self.website_url:
            return self.website_url.rstrip("/")
        return f"https://{self.website_domain}" if self.website_domain else "http://app.lvh.me:3002"

    @property
    def creator_base(self) -> str:
        if self.creator_url:
            return self.creator_url.rstrip("/")
        return f"https://{self.creator_domain}" if self.creator_domain else "http://creator.lvh.me:3002"

    @property
    def ai_enabled(self) -> bool:
        """An OpenRouter key is configured (online embeddings/LLM available)."""
        return bool(self.openrouter_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
