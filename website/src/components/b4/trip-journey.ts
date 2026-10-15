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
  const n = Math.max(1, Math.min(days || 3, 7));
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
