# WishTrip

AI trip planning grounded in a curated travel knowledge base.

| Folder | What |
|---|---|
| [backend/](backend/) | Python + FastAPI: knowledge base, traveler profiles, recommendations, Grok chat |
| [dashboard/](dashboard/) | Next.js knowledge studio for staff: locations, hierarchy, tags, chat, travelers |
| [website/](website/) | Next.js traveler MVP: explore, profile, saved places, trip planner chat |
| [client_work/](client_work/) | The client's earlier knowledge base (770 locations), normalized, plus lessons and brand tokens |
| [PLAN.md](PLAN.md) | Build plan and phases |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Tables, relationships, every API endpoint, and how the flows work |

## Run everything (Docker)

```bash
cp .env.example .env                       # then fill in secrets and OPENROUTER_API_KEY
docker compose up -d --build
docker compose exec backend python -m app.scripts.seed              # admin, demo traveler, sample data
docker compose exec backend python -m app.scripts.import_client_kb  # client knowledge base
```

- Traveler website: http://localhost:3002 (sign up as a traveler)
- Dashboard: http://localhost:3001 (sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`)
- API docs: http://localhost:8000/docs
- Services: Postgres + pgvector on 5433, Redis on 6381, Celery worker for embeddings

Embeddings: locally `EMBEDDING_PROVIDER=ollama` uses `embeddinggemma-2` from your Ollama
(`ollama pull embeddinggemma-2`); the containers reach it at `host.docker.internal:11434`.
Online, set `EMBEDDING_PROVIDER=openrouter` (Gemini Embedding 2). Both store 768-dim
vectors; after switching, click "Index now" on the dashboard overview.

LLM (intent + trip planning): locally `LLM_PROVIDER=ollama` uses `gemma4` through Ollama's
OpenAI-compatible API; on the server `LLM_PROVIDER=openrouter` uses Grok (`INTENT_MODEL`,
`CHAT_MODEL`). Same client and request format for both — switching is the env var only.
`LLM_PROVIDER=none` answers from the knowledge base without any LLM.

```bash
cd backend && uv run python -m app.scripts.eval_intent --provider ollama none   # intent quality
```

Check retrieval quality for any provider:

```bash
cd backend && uv run python -m app.scripts.eval_embeddings --provider hashing ollama
```

## Data honesty rules

- The knowledge base is the source of truth; the AI reasons over it and is fact-checked after.
- Prices are shown only when a verified `price_note` exists, otherwise "not available yet".
- Hotels and flights without verified inventory appear as marked placeholders.
- Imported client estimates live in staff-only `reference` data and never reach travelers or the AI.

## Tests

None of these need an OpenRouter key. Start the stack first (`docker compose up -d`).

```bash
cd backend && uv run pytest                 # backend unit/integration tests (test database)
cd dashboard && pnpm test:api               # all 39 API endpoints against the live backend, each call logged
cd dashboard && pnpm test:e2e               # dashboard end-to-end in a visible (headed) Chromium
cd dashboard && pnpm test:all               # API + dashboard together
cd dashboard && pnpm test:report            # HTML report: per-test API calls, traces, screenshots
cd website && pnpm test:e2e                 # traveler website journey (headed); also asserts the
                                            # browser never calls the backend directly
```

Headed tests run one at a time with a short pause between actions so you can follow along;
`SLOW_MO=600 pnpm test:e2e` slows them further and `pnpm test:e2e:headless` hides the browser.
While they run, the terminal prints every API call the page makes (`→ GET /admin/locations 200 12ms`).
Tests create records named `E2E …` and delete them afterwards; invited test staff users are
disabled (there is no user delete endpoint).

## Development

```bash
cd dashboard && pnpm typecheck && pnpm lint
cd dashboard && pnpm gen:api         # regenerate API types after backend schema changes
```
