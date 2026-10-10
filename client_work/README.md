# Client work — knowledge base and lessons

This folder holds what we are carrying over from the client's earlier build in
[`old_client_work/`](../old_client_work). That repo is **GoExperience**, the first WishTrip,
live at wishtrip.co: a TypeScript trip engine (`packages/domain`), a Fastify API and a
Next.js site, with 355 commits and about 125 handoff documents.

The client's "location information" is the trip engine's knowledge base. It lives in
`old_client_work/packages/domain/src/data/`, and it is the most valuable thing in that repo.

```
client_work/
├── README.md                    ← this file: what we found, what we reuse, what we learned
├── PLAN.md                      ← how it gets into the new platform
├── knowledge_base/
│   ├── locations.json           ← 770 locations, normalized to our schema
│   ├── relations.json           ← 46 routes between cities (minutes, distance, mode)
│   ├── summary.md               ← counts by type and destination
│   └── raw/                     ← untouched exports from the old repo (the source of truth)
└── tools/
    ├── dump.mts, dumpgeo.mts    ← export the TS data modules to JSON (run with tsx)
    └── normalize.py             ← raw/ → locations.json + relations.json
```

## 1. What the location knowledge base contains

| Destination | Country | Cities (old "bases") | Experiences | Hotels | Restaurants |
|---|---|---|---|---|---|
| Goa | India | Goa | 41 | 53 | 31 |
| Kerala | India | Fort Kochi, Munnar, Thekkady, Alleppey, Varkala | 37 | 64 | 28 |
| Dharamshala | India | McLeod Ganj | 24 | 37 | 17 |
| Thailand | Thailand | Bangkok, Pattaya, Phuket, Krabi, Chiang Mai, Koh Samui | 86 | 69 | 97 |
| Japan | Japan | Tokyo, Fuji·Hakone, Kyoto, Osaka, Hiroshima·Miyajima, Sapporo, Okinawa | 81 | 63 | 43 |

Each record carries:

- **Experiences:** themes (culture, nature, food, offbeat, adventure, spiritual, heritage, beach,
  shopping, wellness, nightlife, trekking…), traveller fit (couple, family, family-kids, solo,
  friends, seniors), pace (easy/moderate/active), time of day (AM/PM/EVE), marquee flag,
  strenuous/steps flags, a season tag (sakura, monsoon-safe, beach day…), a one-line insight and a
  traveller-facing blurb.
- **Hotels:** tier (budget/balanced/premium), kind (resort, boutique, ryokan, houseboat…), stars,
  why-it-fits text, traveller fit.
- **Restaurants:** type (local/veg/café…), cuisine, veg and Jain flags, traveller fit.
- **Geography:** venue-level coordinates (`geoCoords.ts`), 75 India sub-zones, and **reviewed
  city-to-city travel times** (`crossBase.ts`: drive, rail and flight minutes, each with
  `verifiedOn`). This took the client the most effort to get right.
- **Opening days:** day-of-week closures with source URL, verification date and confidence
  (`openDays.ts`).
- **Hotel reviews:** only 3 properties, each with source, review count and check date (`hotelReviews.ts`).

### How we mapped it (`tools/normalize.py`)

| Old | New |
|---|---|
| Destination (Kerala…) | kept as `region` on each city; country = India/Thailand/Japan |
| Base (Munnar…) | `city` under its country |
| Experience | `activity` (adventure/trekking/active), `attraction` (marquee/heritage) or `experience` |
| pace easy/moderate/active, strenuous | `energy_level` 2/3/4, 5 |
| tod AM/PM/EVE | `best_times` morning/afternoon/evening |
| travellerFit | `family_friendly`, `couple_friendly` + tags (Solo friendly, Senior friendly…) |
| themes, cuisine, veg/Jain | tags |
| Stay | `hotel`, **imported as draft** |
| Food | `restaurant` |
| crossBase links | `route_to` relations between cities with `travel_minutes` |
| openDays | `opening_hours` with `source` and `verified` date |

### What we deliberately did not carry over as facts

- **Prices.** Hotel `ratePerNight` and experience `ticketPricePerPerson` are hand-entered
  estimates. The old engine priced trips from static per-tier day rates (`staticPricing.ts`).
  Under our data-honesty rule, these figures sit in `reference.*_unverified` for internal use, and
  `price_note` stays empty. Travelers see "price not available yet".
- **Durations.** The old KB never had them. Their own register lists this as K9 and calls it a
  Phase 4 entry blocker. `duration_minutes` is null everywhere, and filling it is the first
  data-entry task.
- **Hotels as live inventory.** The hotel names are real properties, but nothing confirms
  availability or rates. They import as `draft`, so the chat never presents them as bookable
  until someone reviews and publishes them.

### Not imported — sensitive

- `old_client_work/Dubai_Singapore_Trip_History.md`: a personal travel history rebuilt from a
  Gmail inbox (PNRs, booking IDs, a PIN). Not travel knowledge; never import or share it.
- `old_client_work/tmp/applicant_details/`, `tmp/applicant_resumes/`: job applicants' personal
  files. Not read.

## 2. Lessons we are adopting

These come from the client's handoffs and `docs/`. Each one cost them a production bug.

1. **Truth and candour over coverage** (Phase 3C.1, T64). Tags, "straight talk" notes and per-item
   reasons must agree. Never claim an interest is covered when it only partly is, and never call a
   delivered interest missing. For us: the chat's validator and the recommendation `reasons`
   must come from the same verdict.
2. **The KB needs provenance on every fact** (their §7 schema). Opening hours, durations, closures
   and safety markers each need a source URL and a last-verified date. A soft signal
   ("may be tiring") must not silently become a hard exclusion.
3. **Distance honesty beats a tidy map** (Phase 2B/2B.1, T28). Straight-line distance cannot see a
   ridge: McLeod Ganj ↔ Naddi is 2.7 km apart but about 25 minutes by road. Their zone map was so
   coarse that places 75 minutes apart counted as 0 minutes. Six Dharamshala coordinates were
   2–6 km wrong. For us: rank and plan with `travel_minutes` relations, not lat/lng, and store
   `coordinate_precision`.
4. **Safety signals outrank tuning nudges** (testing-lessons). A weight tweak once pushed a solo
   pregnant traveller's alternative hotel to an unbranded property. Hard constraints go first;
   scoring may only break ties between options that already pass. Audit the **alternatives**, not
   just the top pick.
5. **Interest coverage ≠ interest satisfaction.** Explain *suppressed* items (filtered out); stay
   quiet on *competition* (lost to a better option).
6. **Seasonality is a gate, not a garnish.** Monsoon months, sakura, typhoon and seasonal markets
   (Anjuna is Wednesdays, Oct–Mar only) all change what is valid.
7. **Day-of-week openings matter** (K10). 102 of 263 experiences had closure days that broke
   itineraries.
8. **Trip length is in nights** (nights-contract). Carrying a threshold across a days↔nights unit
   change shifted behaviour silently.
9. **Ports and adapters for every external system.** Catalogue, flights, pricing and payment sat
   behind ports with mock adapters. That matches our integration layer.
10. **Test discipline.** Revert the fix and confirm the test goes red. A passing gate is a change
    detector, not a quality judge: every phase needs a traveller's-eye read of real itineraries.

## 3. Product positioning carried forward

From `docs/positioning-moat-and-persona.md`:

- **Value proposition:** *See it. Make it yours. Book it in one go.* Inspire → Personalise → Book.
- **Moat:** a loop of creator itinerary → personalisation → booking → observed choices → better
  personalisation. The asset is the corpus of real itineraries plus how travellers replanned them.
- **Apex persona:** the *Inspired Explorer*. Aged 26–38, metro India, travels as a couple or with
  3–5 friends, takes 2–3 international trips a year, saves reels for months. Secondary persona:
  the *Family Planner*, for whom personalisation means constraints (pace, food, mobility).
- **Implications for us:** the market is India (INR, Indian origin cities, veg/Jain matter). The
  first screen should be an itinerary, not a blank form. The chat is the "make it yours" step.
