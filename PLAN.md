# Wishtrip — Build Plan (Backend + Dashboard)

Source docs: [dev.md](dev.md), [story.md](story.md). Client's earlier build, its location knowledge base and lessons: [client_work/README.md](client_work/README.md) · import plan: [client_work/PLAN.md](client_work/PLAN.md). Guiding rule: **AI is not the source of truth** — the knowledge base and traveler profile are; the LLM reasons over them and its output is validated against rules.

## Repository layout

```
wish-trip/
├── backend/      # Python 3.12 + FastAPI — API, knowledge base, recommendations, AI orchestration
├── dashboard/    # Next.js 15 + TypeScript — Admin Panel (Knowledge Management System)
├── docker-compose.yml   # postgres(+pgvector), redis, backend, worker, dashboard
└── PLAN.md
```

The two apps share one contract: the FastAPI **OpenAPI schema**. The dashboard generates its TypeScript client from it (`openapi-typescript`), so UI types follow API types automatically.

---

## backend/ — Python + FastAPI

### Stack
| Concern | Choice |
|---|---|
| Framework | FastAPI, Pydantic v2, Uvicorn |
| Package mgmt | uv (`pyproject.toml`) |
| DB | PostgreSQL 16 + pgvector, SQLAlchemy 2 (async) + Alembic |
| Cache / state / locks | Redis |
| Background jobs | Celery (Redis broker) |
| AI gateway | OpenRouter, behind an internal `ai/` orchestrator |
| Auth | JWT (access + refresh), role-based (admin, editor, traveler) |
| Media | S3-compatible object storage (MinIO locally) |
| Quality | ruff, mypy, pytest + httpx |

### Structure (modular, domain-first)
```
backend/
├── pyproject.toml
├── alembic/
├── app/
│   ├── main.py              # app factory, routers, middleware
│   ├── core/                # config (pydantic-settings), security, logging, deps
│   ├── db/                  # engine, session, base model
│   ├── modules/
│   │   ├── auth/            # login, tokens, roles
│   │   ├── users/           # users, influencers
│   │   ├── knowledge/       # countries, cities, locations, hotels, restaurants,
│   │   │                    # activities, experiences, routes, relationships, media
│   │   ├── profiles/        # traveler profile: explicit, behavioral, historical
│   │   ├── recommendations/ # preference engine → candidate search → ranking
│   │   ├── itinerary/       # itinerary builder + rule validation
│   │   └── booking/         # booking engine (later phase)
│   ├── ai/                  # orchestrator, OpenRouter client, task→model routing, prompt templates
│   ├── integrations/        # adapter base + flight/hotel/activity adapters (later phase)
│   └── workers/             # Celery app + tasks (embeddings, enrichment)
└── tests/
```
Each module: `models.py` (SQLAlchemy) · `schemas.py` (Pydantic) · `repository.py` · `service.py` · `router.py`.

### Knowledge base data model (MVP)
- `locations` — one polymorphic table, `type` enum (country, city, attraction, hotel, restaurant, activity, experience, route). Columns follow dev.md §7: basic info (name, description, coordinates via PostGIS-style lat/lng, address), travel info (duration_minutes, best_time, opening_hours JSONB, cost_level, seasons), characteristics (energy_level, difficulty, family/couple friendly, accessibility), qualitative (pros[], cons[], recommendations), `parent_id` (London → Tower Bridge), `embedding vector(…)`, `status` (draft/published).
- `location_relations` — `(source_id, target_id, relation, attributes JSONB)`; relations: NEAR, ROUTE_TO, SUITABLE_FOR, REQUIRES, BEST_TIME. This is the knowledge graph in Postgres; Neo4j deferred (dev.md §9).
- `tags` / `location_tags`, `media` (object-storage keys), `influencer_content`.
- `audit_log` — who changed what (security §15).

### API surface (v1)
- `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`
- `GET|POST /admin/locations`, `GET|PATCH|DELETE /admin/locations/{id}`, filter by type/parent/status/search
- `GET|POST|DELETE /admin/locations/{id}/relations`
- `POST /admin/media/upload-url` (presigned upload)
- `GET|POST /admin/tags`, `GET /admin/users`, `GET /admin/audit-log`
- `GET /search/semantic?q=` (pgvector)
- Phase 3+: `/profiles/me`, `/recommendations`, `/itineraries`

---

## dashboard/ — Next.js Admin Panel

The dashboard is the **Knowledge Management System**: the business team controls what Wishtrip knows.

### Stack
| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| Data fetching | TanStack Query + generated OpenAPI client |
| Forms | react-hook-form + zod |
| Tables | TanStack Table |
| Maps | MapLibre / Leaflet (pick coordinates) |
| Auth | JWT from backend, kept in httpOnly cookie via Next route handlers; middleware guards `/(dashboard)` |
| Quality | ESLint, Prettier, Vitest, Playwright |

### Structure
```
dashboard/
├── app/
│   ├── (auth)/login/
│   └── (dashboard)/
│       ├── page.tsx              # overview: counts, drafts, recent edits
│       ├── locations/            # list (filter by type/city/status), [id] edit, new
│       ├── relationships/        # manage NEAR / ROUTE_TO / SUITABLE_FOR links
│       ├── media/                # upload + library
│       ├── influencers/          # influencer content
│       ├── tags/
│       ├── users/                # roles
│       └── audit-log/
├── components/  (ui/, forms/, tables/, map/)
├── lib/         (api/ generated client, auth, utils)
└── middleware.ts
```

### Key screens
1. **Locations list** — table, type/city/status filters, search.
2. **Location editor** — tabbed form mirroring the data model: Basic · Travel info · Characteristics · Pros/Cons · Media · Relationships. Map picker for coordinates. Draft → Publish.
3. **Hierarchy view** — Country → City → children tree (the "London" view in dev.md §6).
4. **Relationship editor** — pick target location + relation type; show neighbors.
5. **Overview** — totals by type, incomplete records (missing best time/duration etc. — these are what AI relies on).

---

## Phases

| Phase | Backend | Dashboard | Outcome |
|---|---|---|---|
| **0. Foundation** (wk 1) | uv project, config, docker-compose (pg+pgvector, redis, minio), Alembic, health check, CI (ruff/mypy/pytest) | create-next-app, Tailwind+shadcn, layout/sidebar, API client generation, CI | Both apps run locally with one command |
| **1. Auth & users** (wk 2) | JWT, roles, users, audit log middleware | Login, protected routes, users page | Admins can sign in |
| **2. Knowledge base CRUD** (wk 3–5) | locations, hierarchy, relations, tags, media presigned upload, validation | Locations list/editor, hierarchy, relationships, media library | Business team can populate the knowledge base |
| **3. Semantic layer** (wk 6) | Celery embedding task on publish (via AI orchestrator), `/search/semantic` | Search bar uses semantic search; completeness indicators | Knowledge is searchable by meaning |
| **4. Traveler profile + recommendations** (wk 7–9) | profiles module, preference engine, candidate search (SQL filters + vector), ranking | Read-only profile/recommendation inspector for admins (debug "why was this recommended") | Ranked candidates from knowledge + profile |
| **5. AI itinerary** (wk 10–12) | AI orchestrator over OpenRouter with per-task model routing, itinerary builder, **rule validation** (durations, opening hours, travel time), Redis caching of AI responses + temp itinerary state | Itinerary preview + validation report for admins; model/prompt config page | LLM-explained itineraries that respect the facts |
| **6. Integrations & booking** (later) | adapter base class, first flight/hotel provider, Redis cache + distributed locks for booking | Provider status, booking monitoring | Bookable trips |

The public traveler-facing site (SEO destination pages, trip planner) is out of this plan's scope. It can be a third Next.js app or live in `dashboard/` under a separate route group later.

---

## Open questions
1. Is "dashboard" only the admin panel, or should it also include the traveler-facing planner?
2. Deployment target (AWS / GCP / Vercel + Render / other)?
3. Which travel providers (Amadeus, Booking, Viator…) come first? This decides how soon Phase 6 starts.
4. Does the MVP need multi-language content?
