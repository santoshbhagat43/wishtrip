import type { Schemas } from "@/lib/api/client";

/**
 * A trip's items as days of stops, for the trip board: one list per day, each stop with when it
 * is, what it is and where it came from (the reel, WishTrip's checked places, or a suggestion).
 */

type Item = Schemas["TripItem"];
export type Stop = {
  /** The trip item's id, to open its details. */
  id?: string;
  when: string;
  kind: string;
  name: string;
  note: string;
  at: string | null;
  /** A TripJack photo of the hotel, for a stay whose name matches one. */
  image?: string | null;
  imageHotel?: string | null;
  /** Where it came from: the creator's video, WishTrip's checked places, or a suggestion. */
  origin: "reel" | "kb" | "suggested" | "creator";
  /** In a trip planned for a party: an extra the traveller may skip, and how to get to the next stop. */
  optional?: boolean;
  transfer?: string;
};
export type ItineraryDay = { n: number; stops: Stop[] };

const WHEN = ["Morning", "Midday", "Afternoon", "Evening"];

const reelTime = (t: number | null | undefined) =>
  typeof t === "number" ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : null;

/** The reel's words about a stop, unless they only repeat its name. */
const noteFor = (s: Item) => {
  const note = s.note.trim().toLowerCase();
  const name = s.name.trim().toLowerCase();
  return !note || name.includes(note) || note.includes(name) ? "" : s.note.slice(0, 48);
};

/** The trip's stops as days: the creator's own days if they set them, else about three a day.
 *  With `days`, the same stops in the same order are spread over that many days instead (a
 *  traveller making the trip their own). */
export function daysFromItems(items: Item[], days?: number): ItineraryDay[] {
  const stops = items.filter((i) => i.name.trim());
  const dayOf = (i: number) => {
    if (days) return Math.floor(i / Math.ceil(stops.length / Math.min(days, Math.max(1, stops.length)))) + 1;
    if (stops.some((s) => s.day)) return stops[i].day ?? 1;
    const perDay = Math.ceil(stops.length / Math.min(7, Math.max(1, Math.ceil(stops.length / 3))));
    return Math.floor(i / perDay) + 1;
  };
  const byDay = new Map<number, Stop[]>();
  stops.forEach((s, i) => {
    const day = byDay.get(dayOf(i)) ?? [];
    byDay.set(dayOf(i), [
      ...day,
      {
        id: s.id,
        when: s.slot ? s.slot.charAt(0).toUpperCase() + s.slot.slice(1) : WHEN[day.length % WHEN.length],
        kind: s.kind,
        name: s.name,
        note: noteFor(s),
        at: s.origin === "reel" ? reelTime(s.t) : null,
        origin: s.origin ?? "reel",
        image: s.image_url ?? null,
        imageHotel: s.image_hotel ?? null,
        optional: s.optional || undefined,
        transfer: s.transfer || undefined,
      },
    ]);
  });
  return [...byDay.entries()].sort(([a], [b]) => a - b).map(([, list], idx) => ({ n: idx + 1, stops: list }));
}
