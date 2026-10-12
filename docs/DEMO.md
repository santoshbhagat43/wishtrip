# Client demo — today, 4:00 pm

Audience: the client. Goal: show that the thing is real, that it understands people, that it
never invents facts, and that the business team can run it. 55 minutes, seven acts, everything
live against the running stack.

Rehearsal for this exact run sheet: `cd website && pnpm test:demo` and `cd dashboard && pnpm test:demo`.
Run both at 3:15 pm (§1).

**The one sentence to repeat:** the knowledge base is the source of truth; the AI only reasons
over what we hand it, and its output is checked before anyone sees it.

What we claim: curated knowledge, intent understanding, grounded answers, a feasibility-checked
itinerary, and a full editorial and support back office. What we do **not** claim: booking, live
prices, reading reels or screenshots, creator-video ingestion. Say this out loud in Act 7.

---

## 1. Pre-flight (3:15 pm — do not skip)

```bash
cd /Users/santosh/Development/wish-trip && docker compose up -d && curl -s localhost:8000/health
```

Expect exactly this:

```json
{"status":"ok","ai_enabled":true,"llm_provider":"openrouter",
 "chat_model":"x-ai/grok-4.3","intent_model":"x-ai/grok-4.3","embedder":"ollama/embeddinggemma-2"}
```

- **Grok 4.3 for both intent and planning is deliberate.** Benchmarked on the same three-turn
  conversation: 4.3 answered in **8, 9 and 7 seconds**; Grok 4.7 took **2 minutes 5 seconds** on
  the follow-up. 4.3 is also half the input price and a quarter of the output price. If a client
  asks why not the biggest model: because we measured. Full table in [infra.md](../infra.md).
- **Embeddings run locally** (`ollama/embeddinggemma-2`), so **Ollama must be running** — the
  query is embedded on every message. Check with `ollama list`.

```bash
cd /Users/santosh/Development/wish-trip/website && pnpm test:demo
```

```bash
cd /Users/santosh/Development/wish-trip/dashboard && pnpm test:demo
```

Both green = every screen in this run sheet works. The website run includes the
**knowledge → plan** test (Act 4b): it adds a place with a staff tip in the dashboard, plans a
trip on the website, checks the place and tip are in the plan, and deletes the place again.
Run it alone, headed, to watch both apps: `cd website && pnpm test:knowledge`. Then:

- Sign in to the dashboard (http://localhost:3001) and the website (http://localhost:3002) in
  **two separate browser windows**, already on `/support` and `/plan`. Don't sign in in front of them.
- Run the Act 2 sequence once yourself at ~3:50 so a finished conversation sits in the sidebar.
- Open in advance: `docs/SCHEMA.md` (the ER diagram), http://localhost:8000/docs.
- Close Slack, email, notifications. Terminal font size up.

---

## 2. Run sheet

### Act 1 — The principle (4:00, 4 min)

No screen yet. Draw this, or show the diagram in [story.md](../story.md):

```
Knowledge base + traveler profile  →  recommendation  →  AI/LLM  →  rule validation  →  itinerary
            (facts)                    (relevance)    (language)     (constraints)
```

> "Every travel AI can write you a nice-sounding itinerary. The question is whether it's true
> and whether it's possible. If our knowledge base says a scenic drive takes four hours, no
> model gets to turn that into a thirty-minute stop. Structured data provides the facts, the
> model provides the language, business rules provide the constraints."

### Act 2 — Intent: how it understands people (4:04, 9 min)

Website → `/plan`, **Describe it** tab. Type this exactly, pointing at the typo before you send:

```
Plan 3 relaxed days in Kerela for my parents, they love tea gardens
```

~8 seconds. Then the **"Your trip so far"** panel on the right:

| Field | Value | Came from |
|---|---|---|
| Destination | Kerala | "Kerela", typo-corrected |
| Trip length | 3 days | "3 relaxed days" |
| Travelling with | Seniors | "my parents" |
| Pace | Very Relaxed (1/5) | "relaxed" |
| Interests | Tea Gardens | stated |

> "Nobody filled in a form. Five structured parameters out of one sentence — and it's those
> parameters, not the chat text, that drive everything downstream. A typo maps to a real
> destination only when the first letter matches, so 'Kerela' becomes Kerala but Kyoto can
> never silently become Tokyo."

**Turn two — a conversation, not a one-shot prompt:**

```
actually make it 4 days from 10 December, and we would rather be out in the evenings
```

Keeps Kerala and seniors; adds 4 days, 10 December, evenings — and **only** evenings: the
model sometimes lists every time of day, and the intent check drops the ones nobody asked for.
The new plan then has an evening stop on each day where we hold one; where we don't, it says
*"No evening option from WishTrip's checked places fits day 2 yet"* instead of inventing one.

**Turn three — travellers can take details back:**

```
dates are flexible now
```

The date **disappears**. Internally that's `cleared_fields: ["start_date"]`.

**The honesty beat.** New trip:

```
Plan 3 days in Reykjavik for a couple
```

Comes back **"General ideas — not from our checked places"**, with no sources panel.

### Act 3 — How we show the data (4:13, 8 min)

Back on the Kerala reply:

- **Grounding badge** — "From places WishTrip has checked".
- **The plan**, with its verdict: *Checked — this plan works* / *we adjusted it so it works* /
  *some days are too full*, and the change spelled out, e.g. *"Moved Tea factory tour & tasting
  to the morning — it's best then, not in the afternoon."*

  > "That sentence wasn't written by the model. A deterministic scheduler re-timed the day
  > against stored opening hours and told the model to say so."

- **Prices** — a verified price or **"not available yet"**. Never a guess.
- **Sources** — `[K1]`–`[K12]`, each a real knowledge-base record.
- **Hotels and flights** — marked placeholders; no verified inventory.

Then `/explore` → a city → a place page: same honesty on a static page. Mention that draft
records — the 262 unverified hotels — are invisible here.

### Act 4 — The back office (4:21, 14 min) — **the new half of the demo**

Switch to the dashboard (`:3001`). This is what the business team runs.

**Review queue** (`/review`) — the badge in the sidebar says 263.

> "Nothing reaches a traveller or the AI until a person decides."

Pick a hotel in **To verify**: the field table shows what we hold and what's missing, six
automatic checks, and the staff-only reference data that never reaches a traveller or the model.
**Mark verified**, then **Publish**. Then point at *The editorial backlog*: 494 records with no
cost level, 485 with no duration.

> "That's the honest state of the imported data, and it's why the planner labels some durations
> as estimates. This screen is how that debt gets paid down."

**Destinations** (`/destinations`) — 22 cities, what each holds, and real demand measured from
chat sessions. Region demand is counted once for the region, not against each of its cities.

**Menus** (`/menus`) — the loop worth showing live. Add a link, or hide one, then refresh the
traveller site and show it change.

> "The traveller site's navigation is data, not a deploy."

**Support inbox** (`/support`) — five real tickets against real travellers and the trips they
actually planned. Open the urgent one: *Arrived in Goa, the beach shack on day 1 is closed*,
marked **In destination**, which is why it's at the top.

> "Someone already travelling outranks everything else in the queue."

The right rail is the traveller's real context — profile, pace, saved places, trips planned, and
the checked itinerary they're asking about. Write a reply; point out the **Internal note**
toggle, which never reaches the traveller and never stops the first-reply clock.

**Support routing** (`/support/routing`) — switch method to **Least busy** and watch "Next new
ticket goes to" change, with the reason. Use **Try it**: destination Goa, channel WhatsApp —
it names the agent and says why, without assigning anything.

> "Every assignment is logged with the sentence explaining it, so nobody has to guess why a
> ticket landed where it did."

**Roles & permissions** (`/roles`) and **System health** (`/system`) — 30 seconds each. The
matrix is read from the API's own guards; system health is read live.

### Act 4b — Staff knowledge becomes part of the plan (live, ~5 min)

The core promise: what the team knows reaches the traveller. Dashboard → **Locations → New**:

- **Name** e.g. *Lakshmi Estate sunset walk*, **Type** Experience, **Status** Published,
  **Belongs to (city)** *Munnar tea hills* (it must sit under its city, or no trip there finds it).
- Summary + description, then **Travel info**: duration 90, best time *evening*;
  **Characteristics**: energy 1; **Knowledge & tags → Insider tips**: *"Carry a light shawl — it
  gets cold after 6 pm, and the estate gate closes at 7 pm."* Fill every tab first, then press
  **Create** once.
- The header shows *"Search index updating"*, then turns to **"Indexed for AI"** by itself within
  ~3 seconds — it's now embedded. Edit the tip and **Save changes** to show it again: the next
  plan uses the edited text.

Website → **New trip**:

```
Plan 2 slow days in Munnar for my parents, they love tea estates and sunset walks
```

The new place is in the plan in the evening, and its card says **"Good to know: Carry a light
shawl…"**.

> "The tip is carried on the stop by the system itself, not left to the model's prose — if staff
> wrote it, the traveller sees it. Where we hold knowledge, it wins; where we don't (Reykjavik),
> the answer is labelled general."

What makes knowledge count: **published**, **under its city**, and the practical advice in
**Insider tips** (sent in full; descriptions are cut at 600 characters for the AI). Delete the
place afterwards — or let `pnpm test:knowledge` show the same flow and clean up after itself.

### Act 5 — How the system works, with the receipts (4:35, 7 min)

Dashboard → **Trip chat**. Ask anything, then open, in order:

1. **Understood intent** — the JSON, including `corrections`. On a live run today it recorded
   *"Ignored destination 'Munnar': the traveler didn't mention it."*
2. **Knowledge base sources** — `K1…K12` with their facts.
3. **What the AI was given** — the literal prompt context. "No hidden prompt magic."
4. **Fact checks applied** — only present when something needed correcting.

Then the architecture in one pass ([story.md](../story.md)): Next.js → FastAPI → Postgres +
pgvector → knowledge base → traveler profile → recommendation engine → LLM → itinerary engine →
Redis → integrations (later) → admin panel.

> "Two LLM calls per message, both replaceable by one env var. We benchmarked five models through
> this pipeline — two failed in ways the validation layer caught. That's the architecture doing
> its job."

### Act 6 — The database (4:42, 6 min)

Open [docs/SCHEMA.md](SCHEMA.md) — the ER diagram renders in the editor.

1. **One polymorphic `locations` table** — country · city · attraction · hotel · restaurant ·
   activity · experience · route. One editor, one search, one embedding path.
2. **`location_relations` is the knowledge graph, in Postgres** — `near`, `route_to`,
   `pairs_with`, with `travel_minutes`. It's what the feasibility engine reads first.
3. **`locations.embedding` is `vector(768)`, HNSW cosine** — facts and meaning in one database.
4. **The traveller and operations side** — profiles, behaviour events, chat state, support
   tickets with their routing log, menus, and an audit log over all of it.

```bash
docker compose exec -T postgres psql -U wishtrip -d wishtrip -c "select type, status, count(*) from locations group by 1,2 order by 1,2;"
```

### Act 7 — What isn't built (4:48, 4 min)

Say it before they ask:

- **Booking is not live.** The button opens a dialog that says exactly that.
- **Live prices** need supplier integrations and the agreements behind them.
- **Reading a reel or a screenshot** — both tabs exist and both say "coming soon".
- **Creator insights** — designed, but there is no creator pipeline yet, so the screen isn't built.
- **Bookings & revenue** — same: no booking rail, so no numbers.
- **Custom roles and per-destination scoping** need a permissions table.

### Q&A and decisions (4:52)

1. Launch destinations — the current five countries, or deep on Kerala and Goa first?
2. Which supplier first, and are those conversations open? Booking moves on contracts, not code.
3. Who owns editorial? The review queue has 519 records with gaps — that's a staffed job.
4. Whose LLM account — theirs or ours? About ₹3 per planned trip.

---

## 3. The four things they first asked about, mapped

| They asked | Where | What proves it |
|---|---|---|
| Intent | Act 2 | One typo'd sentence → five fields; turn 2 adds, turn 3 removes |
| How we show the data | Act 3 | Grounding badge, sources, feasibility verdict, "not available yet" |
| Database schema | Act 6 | ER diagram, live row counts, one polymorphic table + relations + pgvector |
| How the system works | Acts 1 and 5 | The principle, then the four transparency panels |

---

## 4. If something breaks

| Problem | Do this |
|---|---|
| A turn hangs past ~30s | OpenRouter is slow. Fall back to the conversation you pre-ran at 3:50. |
| OpenRouter errors or is out of credit | `LLM_PROVIDER=ollama` in `.env`, `docker compose up -d backend worker` (~20s). Local gemma4, ~35s a turn, everything still works. |
| Semantic search returns nothing | Ollama is down — embeddings are local. `ollama serve`, then `ollama list`. |
| Backend not responding | `docker compose up -d backend worker`, then `curl localhost:8000/health`. Give it 20s. |
| A screen looks empty | `docker compose exec backend python -m app.scripts.seed_support_menus` re-creates tickets, agents and menus. It leaves existing data alone. |
| The model slots a far city into a day | The day's travel line shows it honestly. Say cross-city ranking within a region is current tuning work, and the scheduler is what catches it. |
| They push on booking | "That's M6 and M8 in the plan, gated on supplier contracts and merchant registration, not on engineering." |

## 5. Numbers you can quote (verified today)

- **784** locations, **521** published and indexed, **262** hotels held back as unverified.
- **22** cities across **5** countries; **52** stored routes between places.
- A turn on Grok 4.3: **7–9 seconds**, 12 knowledge-base sources, feasibility-checked.
- **$0.0065** per turn, **≈ $0.033 (₹3)** per planned trip. Hosting from **$95/month** for a
  pilot — [infra.md](../infra.md).
- Retrieval: **100% hit@5, 0.95 MRR@10** with `embeddinggemma-2`, against 7% for the keyword
  fallback.
- Intent: **11 of 12** benchmark messages parsed correctly; 3 of 12 by the keyword fallback.
- **53** dashboard tests, **10** website tests, **203** backend tests — green today.

Don't quote the development plan's compiler numbers (266 tests, a 19,513-trip matrix). Different
document, not verified from this repo.

## 6. Known rough edges (so they don't surprise you)

- **Travelers** and **Staff users** list test accounts (`probe-…`, `e2e-…`, disabled editors)
  left by the automated suites. Their chat sessions are what give Destinations its real demand
  numbers, so they were kept deliberately. If asked: "test accounts from our automated suite."
- The three support agents (Arjun, Leela, Vikram) are seeded accounts with no usable password —
  they exist to be routed to, not to sign in.
- `media` is 0: no photography loaded yet, so place pages use generated gradients.
- **Wheelchair access is unknown for 450 of 494 published places** (37 marked no, 7 yes). Places
  marked "no" never reach a traveler who needs access; unknown ones can, and the plan then warns
  *"Wheelchair access isn't verified yet for: …"*. Filling this in is review-queue work.
