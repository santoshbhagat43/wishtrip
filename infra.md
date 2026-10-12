# Infrastructure & running costs (AWS)

What WishTrip needs to run, what it costs on AWS, and what moves the bill. Written for the
client conversation, so every number says whether it was **measured** here or **estimated**.

- Region assumed: **ap-south-1 (Mumbai)** — the traveller base is Indian, and data stays in India.
- Hosting prices are **indicative on-demand list prices, October 2026**. Verify in the AWS
  Pricing Calculator before quoting a fixed number; they move, and they vary by account.
- The AI line is **measured on this repo today**, not estimated.

---

## 1. What has to run

| Piece | What it is | Today (laptop) |
|---|---|---|
| `backend` | FastAPI — API, knowledge base, retrieval, chat pipeline | Docker container |
| `worker` | Celery — embeddings, enrichment | Docker container |
| `postgres` | PostgreSQL 17 + **pgvector** — facts *and* the 768-d vectors | `pgvector/pgvector:pg17` |
| `redis` | Cache, session state, locks | `redis:7-alpine` |
| `website` | Next.js traveller app (:3002) | Docker container |
| `dashboard` | Next.js staff knowledge studio (:3001) | Docker container |
| Media | Place images | Docker volume → S3 in cloud |
| Embeddings | `embeddinggemma-2`, 768-d | **Local Ollama** |
| LLM | Grok 4.3 for intent + planning | OpenRouter API |

**The one thing that doesn't lift straight to AWS is Ollama.** Embeddings run on the laptop
today. Two ways out, and no GPU is needed either way:

1. **Hosted embeddings.** `EMBEDDING_PROVIDER=openrouter` → `google/gemini-embedding-2`, cut to
   768 dims so the existing column still fits. Verified working today (HTTP 200, 768 values
   returned). Nothing to host, a per-token cost, and a one-off re-index because a new model
   marks every vector stale.
2. **Self-host `embeddinggemma-2` on CPU** next to the backend. It's a ~300M-parameter model; it
   does not need a GPU instance. Zero marginal cost, keeps queries inside the VPC, and keeps the
   benchmarked 100% hit@5 exactly as it is today. Costs ~1 GB of RAM and some vCPU per query.

Recommendation: **option 2 on the same compute** for production, with option 1 as the fallback
switch. Both are one env var — the code supports either.

---

## 2. Three shapes, three bills

### Tier A — Pilot / client demo (one box, today's Docker Compose)

Same `docker-compose.yml` on a single instance. Suitable for the demo, a pilot, and early
content loading. Not highly available.

| Item | Spec | Est. $/month |
|---|---|---|
| EC2 | `m7g.large` (2 vCPU ARM, 8 GB) on-demand | 72 |
| EBS | 100 GB gp3 | 10 |
| Snapshots | ~100 GB | 5 |
| S3 | 20 GB media + requests | 1 |
| Data transfer out | ~50 GB | 6 |
| Route 53 | 1 zone + queries | 1 |
| **Hosting subtotal** | | **≈ $95** |
| AI (1,000 planned trips) | §3 | 33 |
| **Total** | | **≈ $130/month** |

With a 1-year Compute Savings Plan the EC2 line drops roughly 30% (~$50), taking hosting to
about $73.

### Tier B — Production, small (managed, no single point of failure in the app tier)

| Item | Spec | Est. $/month |
|---|---|---|
| ALB | 1 load balancer + modest LCUs | 28 |
| Fargate — backend | 2 × (0.5 vCPU, 1 GB) | 36 |
| Fargate — worker | 1 × (0.25 vCPU, 0.5 GB) | 9 |
| Fargate — website | 2 × (0.5 vCPU, 1 GB) | 36 |
| Fargate — dashboard | 1 × (0.5 vCPU, 1 GB) | 18 |
| RDS PostgreSQL | `db.t4g.medium`, single-AZ | 53 |
| RDS storage + backups | 100 GB gp3 | 17 |
| ElastiCache Redis | `cache.t4g.micro` | 12 |
| S3 + CloudFront | 50 GB stored, ~200 GB delivered | 26 |
| CloudWatch, Secrets Manager | logs, metrics, secrets | 12 |
| **Hosting subtotal** | | **≈ $247** |
| AI (3,000 planned trips) | §3 | 99 |
| **Total** | | **≈ $346/month** |

Two optional lines the client should decide on deliberately:

- **RDS Multi-AZ: +$53/month.** Buys automatic failover. Worth it once real bookings exist; not
  before.
- **NAT Gateway: +$41/month plus $0.056/GB.** Only needed if tasks sit in private subnets with
  no public IP. For this workload, VPC endpoints for S3 and ECR, with tasks in public subnets
  behind the ALB and security groups, is the cheaper and perfectly defensible shape at this size.

Cheaper variant: put the two Next.js apps on **Vercel or Amplify** instead of Fargate (−$54,
minus the ops of two more task definitions) and keep only the Python services on AWS. Reasonable
while traffic is low.

### Tier C — Scale (10,000 planned trips/month, SEO traffic on the public site)

| Item | Spec | Est. $/month |
|---|---|---|
| ALB | higher LCU | 45 |
| Fargate — backend | 4 × (1 vCPU, 2 GB) | 145 |
| Fargate — worker | 2 × (0.5 vCPU, 1 GB) | 36 |
| Fargate — web + dashboard | 3 × (0.5 vCPU, 1 GB) | 54 |
| RDS PostgreSQL | `db.r7g.large`, Multi-AZ | 292 |
| RDS storage + backups | 300 GB gp3 | 50 |
| ElastiCache Redis | `cache.t4g.small` × 2 (primary + replica) | 50 |
| S3 + CloudFront | 200 GB stored, ~2 TB delivered | 215 |
| Observability | logs, traces, alarms | 40 |
| **Hosting subtotal** | | **≈ $927** |
| AI (10,000 planned trips) | §3 | 330 |
| **Total** | | **≈ $1,257/month** |

At this tier a 1-year Savings Plan on Fargate and a Reserved Instance on RDS take 30–40% off the
compute and database lines — roughly $250/month back.

---

## 3. The AI line — measured, not guessed

Measured today against the live pipeline, Grok 4.3 for both the intent call and the planner call:

| Measurement | Value |
|---|---|
| Cost per chat turn (both LLM calls) | **$0.0065** |
| Turn latency | **7–9 seconds** |
| Knowledge-base context sent to the planner | 5,810 characters (~1,500 tokens) |
| Typical turns to a finished trip | ~5 |
| **Cost per planned trip** | **≈ $0.033 (about ₹3)** |

Method: OpenRouter key usage before and after three real turns — $0.01961 for three, through the
full pipeline including retrieval and validation.

| Volume | AI cost/month |
|---|---|
| 1,000 planned trips | $33 |
| 3,000 | $99 |
| 10,000 | $330 |
| 50,000 | $1,650 |

**Model choice moves this line more than anything in AWS.** Benchmarked on the same three-turn
conversation today:

| Planner model | Turn 1 | Turn 2 | Price in/out per M | Verdict |
|---|---|---|---|---|
| **`x-ai/grok-4.3`** | 8.4s | 6.5s | $1.25 / $2.50 | **Chosen.** Fastest, consistent, plan on every turn |
| `x-ai/grok-4.20` | 13.3s | 16.5s | $1.25 / $2.50 | Richer prose, 8 citations, ~2× the latency |
| `x-ai/grok-4.7` | 25.9s | **125s** | $2.00 / $6.00 | Too slow for a conversation, 2.4× the output price |
| `anthropic/claude-haiku-5.5` | 8.9s | 7.7s | $0.10 / $0.50 | 5× cheaper and fast, but **dropped the day structure on the modify turn** (reproduced twice) — needs a prompt fix on that path before it's usable |
| `google/gemini-2.5-flash-lite` | 6.4s | 6.6s | $0.10 / $0.40 | Fastest and cheapest, but came back `partial` grounding with a validation correction on turn 1 |

There's a real saving available here: Haiku 5.5 or Gemini Flash Lite would cut the AI line by
roughly **80%** (about $0.007 per trip instead of $0.033). Both need prompt work on the
`modify_plan` path first — a few days, not a rewrite, and the validation layer already catches
the failures, which is how we spotted them.

**Embeddings**, if hosted rather than self-hosted: a query is ~20 tokens and a place document a
few hundred. Re-indexing all 521 published places is a fraction of a cent; 100,000 searches is
well under a dollar a month. Self-hosted on existing compute it's $0. Either way this is noise
next to the chat line.

---

## 4. What actually drives the bill

In order:

1. **Planner model and turns per trip.** $0.0065 × turns. Capping runaway conversations and
   caching repeated retrievals matters more than any instance size.
2. **CloudFront egress**, once destination pages carry real photography. 2 TB a month is $215 —
   more than the database. Compress aggressively, serve AVIF/WebP, set long cache lifetimes.
3. **RDS**, the moment Multi-AZ is switched on. The vectors live in the same database as the
   facts, which is the right call architecturally (one query, one source of truth), but it means
   the database sizing follows both workloads.
4. **Task count × always-on.** The dashboard is a staff tool; it does not need two tasks, and it
   can scale to zero outside working hours.

## 5. Cost controls worth building in now

- **Graviton (ARM) everywhere** — ~20% cheaper for the same work. Needs `linux/arm64` images;
  the Dockerfiles build fine for it, so set it up in CI from the start rather than migrating later.
- **Meter LLM tokens per trip** (it's already in M11 of the plan). Without it, the AI line is
  invisible until the invoice arrives.
- **Cache retrieval and replies in Redis.** The pipeline already embeds a query once per
  message; repeated destination searches should not re-embed at all.
- **Keep drafts unembedded** — already true, and it's why 263 unverified hotels cost nothing.
- **S3 lifecycle rules** on media, and a CloudFront cache policy with a long TTL.
- **Savings Plan after one month of real traffic**, not before — commit once the shape is known.
- **Budget alarms** at 50/80/100% of an agreed monthly figure, including a separate alarm on the
  OpenRouter spend, which AWS cannot see.

## 6. Before this becomes a quote

Four things to confirm:

1. **pgvector on the chosen RDS engine.** HNSW indexes need pgvector ≥ 0.5; confirm the version
   on the exact RDS PostgreSQL release before committing, or stay on Postgres-in-a-container.
2. **Who owns the OpenRouter (or Bedrock) account** — the client's key or ours? It's roughly a
   third of the Tier B bill at 3,000 trips a month, and it's the line that scales with usage.
3. **Region and data residency.** Mumbai assumed. If outbound travellers' data must stay in
   India, that also constrains which LLM endpoint is acceptable.
4. **Traffic assumptions.** The Tier B and C figures assume 3,000 and 10,000 *planned trips* a
   month; the SEO traffic on destination pages is a separate and potentially larger egress line.

---

Appendix — verified vs estimated in this document:

| Claim | Status |
|---|---|
| $0.0065 per chat turn, 7–9s latency | Measured today against the live stack |
| Model comparison table | Measured today, same prompts, same pipeline |
| 5,810-character planner context | Measured from a stored chat message |
| OpenRouter embeddings work at 768 dims | Verified today (HTTP 200) |
| All AWS monthly figures | Estimated from October 2026 list prices — verify before quoting |
