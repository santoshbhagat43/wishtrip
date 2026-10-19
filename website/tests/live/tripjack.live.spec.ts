/**
 * Is what the API shows really TripJack's data, and how fast is it?
 *
 * Runs against the deployed server (see playwright.live.config.ts and README.md). For each product
 * the test searches, then reads back the values TripJack itself returned (recorded server-side
 * for an hour) and compares them with what we show: hotel names and prices, fare ids and fares,
 * insurance premiums. Every step is timed.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";

const TOKEN = process.env.LIVE_TOKEN;
test.skip(!TOKEN, "Set LIVE_TOKEN (a staff access token); see tests/live/README.md");

// Budgets, in milliseconds. TripJack's own targets: hotel Listing < 3 s, Pricing < 5 s,
// TripSafe search < 0.2 s. Flights publish none; a fresh search is the slow one.
const BUDGET = { hotelSearch: 20_000, hotelPricing: 10_000, flights: 40_000, fareRules: 15_000, insurance: 5_000, cached: 1_500 };

type Supplier = {
  name: string;
  environment: string;
  trace_id: string;
  served_from: "tripjack" | "cache";
  upstream_ms: number;
  server_ms: number;
  calls: { product: string; endpoint: string; status: number; ok: boolean; ms: number; bytes: number }[];
  cache?: { original_trace_id: string; age_seconds: number | null };
};
type Call = Supplier["calls"][number] & { excerpt: any };
type Evidence = { trace_id: string; environment: string; markup_percent: Record<string, number>; calls: Call[] };

const rows: { step: string; wall: number; server: number; upstream: number; source: string; detail: string }[] = [];

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
/** Random dates, so a repeat run is never answered from the previous run's cache. */
const freshOffset = (min: number, span: number) => min + Math.floor(Math.random() * span);

async function post<T>(request: APIRequestContext, path: string, data: unknown) {
  const started = Date.now();
  const res = await request.post(path, { data });
  const wall = Date.now() - started;
  if (res.status() !== 200) {
    // A failed search says where its record is: show what TripJack answered.
    const trace = res.headers()["x-tripjack-trace"];
    let why = "";
    if (trace) {
      const ev = await request.get(`/tripjack/evidence/${trace}`);
      if (ev.ok()) why = JSON.stringify(((await ev.json()) as Evidence).calls.map((c) => ({ endpoint: c.endpoint, status: c.status, ms: c.ms, attempts: (c as any).attempts, error: (c as any).error })));
    }
    expect(res.status(), `${path} after ${wall} ms: ${(await res.text()).slice(0, 300)} TripJack: ${why}`).toBe(200);
  }
  return { body: (await res.json()) as T & { supplier: Supplier }, wall };
}

async function evidenceFor(request: APIRequestContext, supplier: Supplier) {
  const res = await request.get(`/tripjack/evidence/${supplier.trace_id}`);
  expect(res.status(), "the evidence of the TripJack calls should be readable by staff").toBe(200);
  return (await res.json()) as Evidence;
}

/** The claims every response makes about itself. */
function expectFromTripJack(supplier: Supplier, path: RegExp) {
  expect(supplier.name).toBe("tripjack");
  expect(supplier.environment).toMatch(/^UAT/); // TripJack's test environment, until certified
  expect(supplier.served_from).toBe("tripjack");
  const call = supplier.calls.find((c) => path.test(c.endpoint));
  expect(call, `expected a call matching ${path} in ${supplier.calls.map((c) => c.endpoint).join(", ")}`).toBeTruthy();
  expect(call!.endpoint).toMatch(/tripjack\.com/); // a real TripJack host, not ours
  expect(call!.status).toBe(200);
  expect(call!.ok).toBe(true);
  expect(supplier.upstream_ms).toBeGreaterThan(0);
  return call!;
}

function record(step: string, wall: number, supplier: Supplier, detail: string) {
  rows.push({ step, wall, server: supplier.server_ms, upstream: supplier.upstream_ms, source: supplier.served_from, detail });
}

test.describe.configure({ mode: "serial" });

test.describe("TripJack data on the live server", () => {
  test("the API is up and the key is accepted", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    // A staff token is needed for the evidence endpoint; an unknown trace is a clean 404.
    const probe = await request.get("/tripjack/evidence/does-not-exist");
    expect(probe.status()).toBe(404);
  });

  test("hotels: every name and price is what TripJack returned", async ({ request }) => {
    const found = await request.get("/hotels/destinations", { params: { q: "goa", limit: "5" } });
    expect(found.status()).toBe(200);
    const goa = ((await found.json()) as { region_id: number; name: string }[]).find((r) => r.name.endsWith("INDIA"));
    expect(goa, "Goa, India should be in the synced TripJack regions").toBeTruthy();

    const offset = freshOffset(60, 240);
    const search = { region_id: goa!.region_id, check_in: day(offset), check_out: day(offset + 2), rooms: [{ adults: 2 }], sort: "price" };

    // 1. A fresh search goes to TripJack.
    const first = await post<{ hotels: any[]; total: number }>(request, "/hotels/search", search);
    const call = expectFromTripJack(first.body.supplier, /hms\/v3\/hotel\/listing/);
    expect(first.body.hotels.length).toBeGreaterThan(0);
    record("hotels: first search (live)", first.wall, first.body.supplier, `${first.body.hotels.length} hotels`);
    expect(first.wall).toBeLessThan(BUDGET.hotelSearch);

    // 2. What TripJack returned, from the recorded evidence of every Listing call.
    const evidence = await evidenceFor(request, first.body.supplier);
    const upstream = new Map<string, any>();
    for (const c of evidence.calls.filter((c) => /hotel\/listing/.test(c.endpoint))) {
      for (const h of c.excerpt.hotels) upstream.set(String(h.hotelId), h);
    }
    expect(upstream.size).toBeGreaterThan(0);
    const markup = evidence.markup_percent.hotels;

    // 3. Compare every hotel we show.
    let namesEqual = 0;
    const nameDiffs: string[] = [];
    for (const shown of first.body.hotels) {
      const raw = upstream.get(String(shown.hotel_id));
      expect(raw, `hotel ${shown.hotel_id} (${shown.name}) was not in TripJack's Listing answer`).toBeTruthy();

      if (norm(raw.name) === norm(shown.name)) namesEqual += 1;
      else nameDiffs.push(`${shown.hotel_id}: shown "${shown.name}" vs TripJack listing "${raw.name}"`);

      // The cheapest bookable option, priced as TripJack sent it (our markup on the base only).
      const cheapest = [...raw.options].sort((a: any, b: any) => a.total - b.total)[0];
      const price = shown.option.price;
      expect(price.base, `${shown.name}: base`).toBeCloseTo(cheapest.base * (1 + markup / 100), 1);
      expect(price.taxes, `${shown.name}: taxes`).toBeCloseTo(cheapest.taxes, 1);
      expect(price.management_fee, `${shown.name}: management fee`).toBeCloseTo(cheapest.mf ?? 0, 1);
      expect(price.total, `${shown.name}: total = base + taxes + fees`).toBeCloseTo(price.base + price.taxes + price.management_fee + price.management_fee_tax, 1);
      if (markup === 0) expect(price.total, `${shown.name}: total is exactly TripJack's`).toBeCloseTo(cheapest.total, 1);
      expect(shown.option.option_id).toBe(cheapest.optionId);
    }
    test.info().annotations.push({
      type: "hotels checked",
      description: `${first.body.hotels.length} hotels: prices equal TripJack's; names equal in ${namesEqual}. Markup ${markup}%.`,
    });
    // Names come from TripJack's content catalogue; the Listing name may be spelled differently.
    if (nameDiffs.length) test.info().annotations.push({ type: "name differences", description: nameDiffs.slice(0, 5).join(" | ") });
    expect(namesEqual / first.body.hotels.length, `names should match TripJack's:\n${nameDiffs.slice(0, 5).join("\n")}`).toBeGreaterThanOrEqual(0.9);
    expect(call.ms).toBeGreaterThan(0);

    // 4. The same search again is answered from our cache, and says which TripJack call it came from.
    const again = await post<{ hotels: any[] }>(request, "/hotels/search", search);
    expect(again.body.supplier.served_from).toBe("cache");
    expect(again.body.supplier.calls).toEqual([]);
    expect(again.body.supplier.cache!.original_trace_id).toBe(first.body.supplier.trace_id);
    expect(again.body.hotels.map((h) => [h.hotel_id, h.option.price.total])).toEqual(first.body.hotels.map((h) => [h.hotel_id, h.option.price.total]));
    record("hotels: same search again (cache)", again.wall, again.body.supplier, `age ${again.body.supplier.cache!.age_seconds}s`);
    expect(again.wall).toBeLessThan(BUDGET.cached);

    // 5. One hotel's full price list, live.
    const cheapestShown = first.body.hotels[0];
    const priced = await post<{ hotel: any; options: any[] }>(request, `/hotels/${cheapestShown.hotel_id}/pricing`, {
      check_in: search.check_in, check_out: search.check_out, rooms: search.rooms,
    });
    expectFromTripJack(priced.body.supplier, /hms\/v3\/hotel\/pricing/);
    record("hotels: one hotel's options (live)", priced.wall, priced.body.supplier, `${priced.body.options.length} options`);
    expect(priced.wall).toBeLessThan(BUDGET.hotelPricing);
    const pricingEvidence = (await evidenceFor(request, priced.body.supplier)).calls.find((c) => /hotel\/pricing/.test(c.endpoint))!;
    const rawOptions = new Map<string, any>(pricingEvidence.excerpt.options.map((o: any) => [o.optionId, o]));
    expect(priced.body.options.length).toBeGreaterThan(0);
    for (const o of priced.body.options) {
      const raw = rawOptions.get(o.option_id);
      expect(raw, `option ${o.option_id} should be one TripJack returned`).toBeTruthy();
      expect(o.price.taxes).toBeCloseTo(raw.taxes, 1);
      expect(o.meal_basis).toBe(raw.meal);
      expect(o.rooms.map((r: any) => r.name)).toEqual(raw.rooms);
    }
    expect(norm(priced.body.hotel.name)).toBe(norm(cheapestShown.name));
  });

  test("flights: every fare is one TripJack quoted", async ({ request }) => {
    const offset = freshOffset(30, 150);
    const adults = 2;
    const search = { legs: [{ origin: "DEL", destination: "GOI", date: day(offset) }], adults, sort: "price" };

    const live = await post<{ flights: any[]; total: number }>(request, "/flights/search", search);
    expectFromTripJack(live.body.supplier, /fms\/v1\/air-search-all/);
    expect(live.body.flights.length).toBeGreaterThan(10);
    record("flights: first search (live)", live.wall, live.body.supplier, `${live.body.total} trips`);
    expect(live.wall).toBeLessThan(BUDGET.flights);

    const evidence = await evidenceFor(request, live.body.supplier);
    const call = evidence.calls.find((c) => /air-search-all/.test(c.endpoint))!;
    const markup = evidence.markup_percent.flights;
    const rawFares = new Map<string, { flights: string[]; type: string; adult: Record<string, number> }>();
    for (const trip of call.excerpt.trips) for (const f of trip.fares) rawFares.set(f.id, { flights: trip.flights, type: f.type, adult: f.adult });

    let checked = 0;
    for (const trip of live.body.flights.slice(0, 40)) {
      const numbers = trip.legs.flat().map((s: any) => s.flight_number);
      for (const fare of trip.fares) {
        const raw = rawFares.get(fare.price_id);
        expect(raw, `fare ${fare.price_id} should be one TripJack quoted`).toBeTruthy();
        expect(numbers, `flight numbers for ${fare.price_id}`).toEqual(raw!.flights);
        expect(fare.fare_type).toBe(raw!.type);
        expect(fare.price.base, "base fare for the whole party").toBeCloseTo(raw!.adult.BF * adults * (1 + markup / 100), 1);
        expect(fare.price.taxes, "taxes for the whole party").toBeCloseTo(raw!.adult.TAF * adults, 1);
        checked += 1;
      }
    }
    test.info().annotations.push({ type: "fares checked", description: `${checked} fares across ${Math.min(40, live.body.flights.length)} trips; markup ${markup}%` });

    // Repeat: from cache.
    const again = await post<{ flights: any[] }>(request, "/flights/search", search);
    expect(again.body.supplier.served_from).toBe("cache");
    expect(again.body.supplier.cache!.original_trace_id).toBe(live.body.supplier.trace_id);
    record("flights: same search again (cache)", again.wall, again.body.supplier, `age ${again.body.supplier.cache!.age_seconds}s`);
    expect(again.wall).toBeLessThan(BUDGET.cached);

    // Fare rules for the cheapest regular fare.
    const fare = live.body.flights.flatMap((t) => t.fares).find((f: any) => f.fare_type === "PUBLISHED") ?? live.body.flights[0].cheapest;
    const rules = await post<{ sectors: Record<string, Record<string, any[]>> }>(request, "/flights/fare-rules", { price_id: fare.price_id });
    expectFromTripJack(rules.body.supplier, /fms\/v2\/farerule/);
    record("flights: fare rules (live)", rules.wall, rules.body.supplier, Object.keys(rules.body.sectors).join(", "));
    expect(rules.wall).toBeLessThan(BUDGET.fareRules);
    const rawRules = (await evidenceFor(request, rules.body.supplier)).calls.find((c) => /farerule/.test(c.endpoint))!.excerpt.sectors;
    expect(Object.keys(rules.body.sectors).sort()).toEqual(Object.keys(rawRules).sort());
    for (const [sector, kinds] of Object.entries(rules.body.sectors)) {
      for (const [kind, bands] of Object.entries(kinds)) {
        expect(bands.length, `${sector} ${kind}`).toBe(rawRules[sector][kind].length);
        bands.forEach((b: any, i: number) => {
          expect(b.airline_fee).toBeCloseTo(rawRules[sector][kind][i].amount ?? 0, 1);
          expect(b.from_hours).toBe(Number(rawRules[sector][kind][i].st));
        });
      }
    }
  });

  test("insurance: every plan and premium is TripSafe's", async ({ request }) => {
    const offset = freshOffset(30, 200);
    const body = {
      start_date: day(offset),
      end_date: day(offset + 4),
      traveller_dobs: ["1990-05-14", "1988-11-02"],
      destinations: [{ key: "TH", type: "COUNTRY" }],
    };
    const live = await post<{ plans: any[]; total: number; search_id: string }>(request, "/insurance/search", body);
    expectFromTripJack(live.body.supplier, /insurance\/v2\/search/);
    expect(live.body.plans.length).toBeGreaterThan(0);
    record("insurance: first search (live)", live.wall, live.body.supplier, `${live.body.total} plans`);
    expect(live.wall).toBeLessThan(BUDGET.insurance);

    const evidence = await evidenceFor(request, live.body.supplier);
    const call = evidence.calls.find((c) => /insurance\/v2\/search/.test(c.endpoint))!;
    const markup = evidence.markup_percent.insurance;
    expect(live.body.search_id).toBe(call.excerpt.searchId);
    const raw = new Map<string, any>(call.excerpt.plans.map((p: any) => [p.productId, p]));
    expect(live.body.plans.length).toBe(call.excerpt.count);
    for (const plan of live.body.plans) {
      const r = raw.get(plan.product_id);
      expect(r, `plan ${plan.product_id} should be one TripSafe returned`).toBeTruthy();
      expect(plan.insurer).toBe(r.insurer);
      expect(plan.price.total, `${plan.product_id} premium`).toBeCloseTo(r.totalFare * (1 + markup / 100), 1);
    }

    const again = await post<{ plans: any[] }>(request, "/insurance/search", body);
    expect(again.body.supplier.served_from).toBe("cache");
    record("insurance: same search again (cache)", again.wall, again.body.supplier, `age ${again.body.supplier.cache!.age_seconds}s`);
    expect(again.wall).toBeLessThan(BUDGET.cached);
  });

  test("speed summary", async ({}, testInfo) => {
    const ms = (n: number) => `${(n / 1000).toFixed(2)} s`;
    const header = "| Step | You waited | Our server | TripJack | We add | Served from | Detail |\n| --- | ---: | ---: | ---: | ---: | --- | --- |";
    const lines = rows.map((r) => `| ${r.step} | ${ms(r.wall)} | ${ms(r.server)} | ${r.upstream ? ms(r.upstream) : "-"} | ${ms(Math.max(0, r.wall - r.upstream))} | ${r.source} | ${r.detail} |`);
    const md = [
      "# TripJack on the live server: where the data comes from and how fast",
      "",
      `API: ${process.env.LIVE_API_URL ?? "https://wishtrip-api.listnr.co"} · ${new Date().toISOString()}`,
      "",
      "*You waited* is the whole round trip from this computer. *TripJack* is the time TripJack itself took (summed over its calls). *We add* is everything else: the network to our server, our database and our reshaping.",
      "",
      header,
      ...lines,
      "",
    ].join("\n");
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/tripjack-live-summary.md", md);
    await testInfo.attach("tripjack-live-summary", { body: md, contentType: "text/markdown" });
    console.log("\n" + md);
    expect(rows.length).toBeGreaterThanOrEqual(7);
  });
});
