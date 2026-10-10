# Plan — bringing the client's knowledge base into the new Wishtrip

Context: [README.md](README.md). Main build plan: [../PLAN.md](../PLAN.md).

## Step 1 — Schema additions (backend, small migration)

Add to `locations`:

| Column | Why |
|---|---|
| `source` (str), `external_id` (str, unique per source) | Re-imports update rows instead of duplicating; we can always trace a fact back |
| `reference` (JSONB, staff-only) | Holds unverified client data (indicative rates, ticket prices, tier, stars) without ever showing it to travelers |
| `provenance` (JSONB) | `coordinate_precision`, `needs_verification`, source URLs and verified dates |
| `region` (str) | "Kerala", "Goa", "Himachal Pradesh": travelers say "Kerala", not "Munnar" |
| `highlight` (bool) | The old `marquee` flag: must-see anchors rank higher |

Chat change: `resolve_destination` also matches `region`, so "plan Kerala for 6 days" resolves
to the five Kerala cities.

## Step 2 — Importer (`backend/app/scripts/import_client_kb.py`)

- Reads `client_work/knowledge_base/{locations,relations}.json`.
- Upserts by `(source, external_id)`: creates tags as needed, resolves parents, creates
  `route_to` relations.
- Hotels stay `draft`; everything else is `published`.
- Embeds the published rows (Gemini Embedding 2 once the OpenRouter key is set).
- Idempotent: running it twice changes nothing. Run with:
  `docker compose exec backend python -m app.scripts.import_client_kb`

## Step 3 — Dashboard support

- Location editor shows **Source**, **Coordinate precision** and a staff-only
  **Reference data (unverified)** panel.
- Filter: "Needs verification" (hotels, zone-centroid coordinates, missing durations).
- Completeness already flags missing duration, so the 747 imported places show up as the
  data-entry queue.

## Step 4 — Data work for the team (no code)

Priority order, using the client's own register:

1. **Durations (K9)** for the ~270 experiences; the planner cannot schedule a day without them.
2. **Verify and publish hotels**, city by city, starting with the demo cities.
3. **Fix the 128 zone-centroid coordinates** to venue level.
4. **Seasonal calendar (K7):** monsoon, sakura and market seasons as `seasons` + notes.
5. **Opening hours with sources (K1):** extend the day-of-week records to full hours.

## Step 5 — Engine features this data unlocks

| Feature | Uses | Lesson applied |
|---|---|---|
| Multi-city trips (Kerala, Japan) | `route_to` travel minutes | Distance honesty |
| Season gating in recommendations | `seasons`, monsoon months | Seasonality is a gate |
| Day-of-week filtering | `opening_hours.open_days` | K10 |
| Safety hard constraints (senior, mobility, pregnancy) | `difficulty`, `accessible`, cautions | Safety outranks tuning |
| "Straight talk" in chat | shared verdict for reasons and validator | Truth and candour |

## Decisions needed from you

1. **Hotels as draft.** OK to keep all 262 hidden from travelers until verified? (Recommended.)
2. **Reference prices.** Keep the client's indicative INR rates as staff-only reference
   (recommended), or drop them?
3. **Region level.** Store "Kerala" as a `region` field on cities (recommended, simple), or add a
   full `region` location type between country and city?
4. **Currency and market.** Confirm India-first (INR, Indian origin cities), as in the client's
   positioning.
