"use client";

import { ChevronDown, Globe, Lightbulb } from "lucide-react";
import Link from "next/link";

import { gradientFor } from "@/components/trip/visuals";
import { Badge } from "@/components/ui/badge";
import type { Schemas } from "@/lib/api/client";
import { titleCase } from "@/lib/format";

import { BlankSlot, needsStay } from "./blank-slot";

type Suggestion = Schemas["Suggestion"];

const SLOT_ORDER: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, night: 3 };
const SLOT_LABEL: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

function dayDate(startDate: string | null | undefined, day: number) {
  if (!startDate) return null;
  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + day - 1);
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

const slotOf = (s: Suggestion) => SLOT_LABEL[s.time_of_day ?? ""] ?? "Anytime";

/**
 * A day-by-day plan for a destination WishTrip doesn't hold yet. Same shape as the checked
 * itinerary, but honest about what it isn't: no clock times, durations, travel times or
 * prices, because we have nothing verified to compute them from. Hotels and flights are
 * blank slots until partners are connected.
 */
export function GeneralItinerary({
  suggestions,
  startDate,
  types = null,
}: {
  suggestions: Suggestion[];
  startDate?: string | null;
  /** Only show stops of these types (the trip board's filter chips); null shows everything. */
  types?: readonly string[] | null;
}) {
  const byDay = new Map<number, Suggestion[]>();
  for (const s of suggestions) if (s.day != null) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const lastDay = days.at(-1) ?? 1;
  const flights = suggestions.some((s) => s.type === "flight");
  const more = suggestions.filter((s) => s.day == null && !s.is_placeholder);
  const showStays = !types || types.includes("hotel");
  const showFlights = !types || types.includes("flight");

  return (
    <div className="flex flex-col gap-3">
      <p className="flex gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
        <Globe className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="font-semibold">A general plan.</span> These places aren&apos;t in WishTrip&apos;s checked list yet, so
          opening hours, travel times and prices haven&apos;t been verified.
        </span>
      </p>
      {days.map((day) => {
        // Hotels and flights are drawn as blank slots below, not as made-up options.
        const stops = byDay
          .get(day)!
          .filter((s) => !s.is_placeholder)
          .sort((a, b) => (SLOT_ORDER[a.time_of_day ?? ""] ?? 1.5) - (SLOT_ORDER[b.time_of_day ?? ""] ?? 1.5));
        const items = types ? stops.filter((s) => types.includes(s.type)) : stops;
        const arrival = flights && showFlights && day === days[0];
        const home = flights && showFlights && day === lastDay && lastDay > days[0];
        const stay = showStays && needsStay(day, lastDay);
        const date = dayDate(startDate, day);
        return (
          <details key={day} open className="group rounded-[22px] border border-border bg-surface shadow-card">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 group-[:not([open])]:border-b-0">
              <p className="flex items-center gap-2 font-display text-lg">
                <ChevronDown className="size-4 text-muted transition-transform group-[:not([open])]:-rotate-90" />
                Day {day}
                {date && <span className="font-sans text-sm text-muted">{date}</span>}
              </p>
              <span className="text-xs text-muted">{stops.length} {stops.length === 1 ? "idea" : "ideas"}</span>
            </summary>
            <div className="flex flex-col gap-2 px-5 py-3">
              {arrival && <BlankSlot kind="flight" label="Arrival flight" />}
              {items.length === 0 && !arrival && !home && !stay && (
                <p className="py-1 text-sm text-muted">Nothing of this kind on this day.</p>
              )}
              {items.length > 0 && (
                <ol>
                  {items.map((item, i) => {
                    const slot = slotOf(item);
                    const newSlot = i === 0 || slotOf(items[i - 1]) !== slot;
                    return (
                      <li key={`${item.name}-${i}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
                        {/* On phones the label sits above the stop (and only when the time changes). */}
                        <span className={`shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wide text-brand sm:w-20 ${newSlot ? "" : "hidden sm:block"}`}>
                          {newSlot ? slot : ""}
                        </span>
                        <span aria-hidden className="mt-0.5 hidden size-11 shrink-0 rounded-xl sm:block" style={{ background: gradientFor(item.name) }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {item.location_id ? (
                              <Link href={`/places/${item.location_id}`} className="font-medium hover:text-brand">{item.name}</Link>
                            ) : (
                              <span className="font-medium">{item.name}</span>
                            )}
                            {item.from_knowledge_base && <Badge tone="ok">Checked by WishTrip</Badge>}
                          </div>
                          <p className="text-xs text-muted">
                            {titleCase(item.type)} · Price: {item.price ?? <span className="italic">not available yet</span>}
                          </p>
                          {item.why && <p className="mt-0.5 text-sm text-muted">{item.why}</p>}
                          {item.tip && (
                            <p className="mt-2 flex gap-2 rounded-xl bg-value-soft px-3 py-2 text-sm">
                              <Lightbulb className="mt-0.5 size-4 shrink-0" />
                              <span><span className="font-semibold">Good to know: </span>{item.tip}</span>
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {stay && <BlankSlot kind="stay" label="Hotel for tonight" />}
              {home && <BlankSlot kind="flight" label="Flight home" />}
            </div>
          </details>
        );
      })}
      {more.length > 0 && !types && (
        <div className="rounded-[22px] border border-border bg-surface px-5 py-3 shadow-card">
          <p className="text-sm font-semibold">More ideas</p>
          <ul className="mt-1 space-y-1.5 text-sm">
            {more.map((s, i) => (
              <li key={`${s.name}-${i}`}>
                <span className="font-medium">{s.name}</span>
                {s.why && <span className="text-muted"> — {s.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
