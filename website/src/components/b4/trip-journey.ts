"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type ReelImport = Schemas["ReelImportRead"];
export type ReelPlace = Schemas["ReelPlace"];

/** The reel import that a trip journey (details → board → book) is built from. */
export function useReelImport(id: string | null) {
  return useQuery({
    queryKey: ["reel-import", id],
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET("/reels/imports/{import_id}", { params: { path: { import_id: id! } } })),
  });
}

export type PublicTrip = Schemas["PublicTripRead"];
export type MineTrip = Schemas["MineRead"];
export type MineConfig = Schemas["MineConfig"];

/** A creator's published trip (by its share code), the starting point for "Make it mine". */
export function usePublicTrip(code: string | null) {
  return useQuery({
    queryKey: ["public-trip", code],
    enabled: !!code,
    retry: false,
    queryFn: async () => {
      const r = await api.GET("/trips/{share_code}", { params: { path: { share_code: code! } } });
      return r.response.status === 404 ? null : unwrap(r);
    },
  });
}

/** Who is travelling, as the Details screen collects it. */
export type Party = { adults: number; kids: number; seniors: number };
export const partySize = (p: Party) => p.adults + p.kids + p.seniors;
export function partyText(p: Party) {
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : null);
  return [part(p.adults, "adult", "adults"), part(p.kids, "child", "children"), part(p.seniors, "senior", "seniors")]
    .filter(Boolean)
    .join(", ");
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export type DayItem = { name: string; kind: string; note: string; when: string };
export type Day = { n: number; title: string; items: DayItem[] };

const WHEN = ["Morning", "Midday", "Afternoon", "Evening"];
const KIND_WORD: Record<string, string> = {
  stay: "Check in", food: "Eat", sight: "See", experience: "Do", area: "Explore",
};

/** Arrange a reel's places into a day-by-day board (deterministic, no invented prices). */
export function buildDays(places: ReelPlace[], days: number): Day[] {
  const stops = places.filter((p) => p.kind !== "area" && p.kind !== "stay");
  const stay = places.find((p) => p.kind === "stay");
  const n = Math.max(1, Math.min(days || 3, 14));
  const perDay = Math.max(1, Math.ceil(stops.length / n));
  const out: Day[] = [];
  for (let d = 0; d < n; d++) {
    const slice = stops.slice(d * perDay, (d + 1) * perDay);
    if (!slice.length && d > 0) break;
    const items: DayItem[] = slice.map((p, i) => ({
      name: p.location_name ?? p.name,
      kind: p.kind,
      note: p.evidence || "",
      when: WHEN[Math.min(i, WHEN.length - 1)],
    }));
    if (d === 0 && stay) {
      items.unshift({ name: stay.location_name ?? stay.name, kind: "stay", note: stay.evidence || "", when: "Check in" });
    }
    out.push({ n: d + 1, title: slice[0]?.location_name ?? slice[0]?.name ?? `Day ${d + 1}`, items });
  }
  return out;
}

export const kindLabel = (k: string) => KIND_WORD[k] ?? "Visit";

export type StayPrice = Schemas["StayPrice"];

/** What TripJack charges now for each stay that matches a hotel, for the trip's dates and party.
 * Read on its own so the trip opens at once; kept for a few minutes, then asked again. */
export function useStayPrices(code: string | null) {
  return useQuery({
    queryKey: ["stay-prices", code],
    enabled: !!code,
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async () => unwrap(await api.GET("/my-trips/{code}/stay-prices", { params: { path: { code: code! } } })),
  });
}

export type FlightPrice = Schemas["FlightPrice"];

/** The live return fare for the party on the trip's dates (or why there isn't one). */
export function useFlightPrice(code: string | null) {
  return useQuery({
    queryKey: ["flight-price", code],
    enabled: !!code,
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async () => unwrap(await api.GET("/my-trips/{code}/flight-price", { params: { path: { code: code! } } })),
  });
}

type StayPrices = Schemas["StayPrices"];

/** The price card from what TripJack answered, or null when it priced nothing (then the card says
 *  that nothing is priced yet, with no figure). Only flights and hotels have a live price; transfers, experiences and
 *  meals are priced at checkout, and a stay with no price is said to be unpriced, never filled in. */
export function livePrices(flight: FlightPrice | undefined, stays: StayPrices | undefined, travellers: number) {
  const flightTotal = flight?.status === "priced" ? (flight.total ?? 0) : 0;
  const priced = stays?.stays.filter((s) => s.status === "priced") ?? [];
  const stayTotal = priced.reduce((n, s) => n + (s.total ?? 0), 0);
  if (!flightTotal && !stayTotal) return null;
  const missing = (stays?.stays.length ?? 0) - priced.length;
  const times = [flight?.checked_at, stays?.checked_at].filter((t): t is string => !!t).sort();
  return {
    rows: [
      [`Flights · ${travellers} ${travellers === 1 ? "seat" : "seats"}`, flightTotal ? inr(flightTotal) : "Not priced"],
      ["Stay", stayTotal ? `${inr(stayTotal)}${missing ? ` · ${missing} not priced` : ""}` : "Not priced"],
      ["Experiences & meals", "At checkout"],
      ["Transfers", "At checkout"],
    ] as const,
    total: inr(flightTotal + stayTotal),
    // The oldest of the answers: the figure is as fresh as its stalest part.
    checkedAt: times[0] ?? null,
    complete: !!flightTotal && !missing && priced.length > 0,
  };
}

/** "14:05" in the traveller's own clock, from the time TripJack was asked. */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** A trip made for the traveller ("Make it mine"), by its code: how they left it. */
export function useMineTrip(code: string | null) {
  return useQuery({
    queryKey: ["mine-trip", code],
    enabled: !!code,
    retry: false,
    // While the plan is being built, look again every couple of seconds.
    refetchInterval: (query) => (query.state.data?.build_status === "building" ? 2000 : false),
    queryFn: async () => {
      const r = await api.GET("/my-trips/{code}", { params: { path: { code: code! } } });
      return r.response.status === 404 ? null : unwrap(r);
    },
  });
}
