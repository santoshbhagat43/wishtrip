"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Footprints, Info, Lightbulb, Wrench } from "lucide-react";
import Link from "next/link";

import { SaveButtons } from "@/components/trip/place-card";
import { gradientFor } from "@/components/trip/visuals";
import { Badge, type Tone } from "@/components/ui/badge";
import type { Schemas } from "@/lib/api/client";
import { minutes, titleCase } from "@/lib/format";

import { BlankSlot, needsStay } from "./blank-slot";

type Day = Schemas["ItineraryDay"];
type Feasibility = Schemas["Feasibility"];

const STATUS: Record<string, { label: string; tone: Tone; icon: typeof Info }> = {
  feasible: { label: "Checked — this plan works", tone: "ok", icon: CheckCircle2 },
  repaired: { label: "Checked — we adjusted it so it works", tone: "info", icon: Wrench },
  needs_attention: { label: "Checked — some days are too full", tone: "danger", icon: AlertTriangle },
};

export function Itinerary({
  days,
  feasibility,
  types = null,
}: {
  days: Day[];
  feasibility: Feasibility;
  /** Only show stops of these types (the trip board's filter chips); null shows everything. */
  types?: readonly string[] | null;
}) {
  const status = STATUS[feasibility.status] ?? STATUS.feasible;
  const warnings = feasibility.issues.filter((i) => i.severity !== "info");
  const notes = feasibility.issues.filter((i) => i.severity === "info");
  return (
    <div className="flex flex-col gap-3">
      <Badge tone={status.tone} className="self-start"><status.icon className="size-3.5" /> {status.label}</Badge>
      {feasibility.changes.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-info-soft px-4 py-2.5 text-sm text-info">
          {feasibility.changes.map((c) => <li key={c}>• {c}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          {warnings.map((w) => <li key={w.message}>⚠ {w.message}</li>)}
        </ul>
      )}
      {days.map((day) => {
        const used = day.activity_minutes + day.travel_minutes;
        // Sample hotels and flights become blank slots: no partner inventory, so nothing to name.
        const stops = day.items.filter((item) => !item.is_placeholder);
        const items = types ? stops.filter((item) => types.includes(item.type)) : stops;
        const lastDay = days.at(-1)?.day ?? day.day;
        const flight = day.items.some((item) => item.is_placeholder && item.type === "flight") && (!types || types.includes("flight"));
        const arrival = flight && day.day === days[0]?.day;
        const home = flight && !arrival;
        const stay = (!types || types.includes("hotel")) && needsStay(day.day, lastDay);
        return (
          <details key={day.day} open className="group rounded-[22px] border border-border bg-surface shadow-card">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 group-[:not([open])]:border-b-0">
              <p className="flex items-center gap-2 font-display text-lg">
                <ChevronDown className="size-4 text-muted transition-transform group-[:not([open])]:-rotate-90" />
                Day {day.day}
                {day.date && <span className="font-sans text-sm text-muted">{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</span>}
              </p>
              <span className="text-xs text-muted">{minutes(used)} planned · fits {minutes(day.capacity_minutes)} at your pace</span>
            </summary>
            {arrival && <div className="px-5 pt-3"><BlankSlot kind="flight" label="Arrival flight" /></div>}
            {stops.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">A free day to wander.</p>
            ) : items.length === 0 ? (
              !stay && !home && <p className="px-5 py-4 text-sm text-muted">Nothing of this kind on this day.</p>
            ) : (
              <ol className="px-5 py-3">
                {items.map((item, i) => (
                  <li key={`${item.name}-${i}`}>
                    {!types && i > 0 && item.travel_minutes_before > 0 && (
                      <p className="flex items-center gap-1.5 py-1 pl-16 text-xs text-muted">
                        <Footprints className="size-3" /> about {minutes(item.travel_minutes_before)} to get there{item.travel_estimated ? " (estimate)" : ""}
                      </p>
                    )}
                    <div className="flex gap-3 py-2 sm:gap-4">
                      <span className="w-12 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-brand">{item.start}</span>
                      <span aria-hidden className="mt-0.5 hidden size-11 shrink-0 rounded-xl sm:block" style={{ background: gradientFor(item.name) }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.location_id ? (
                            <Link href={`/places/${item.location_id}`} className="font-medium hover:text-brand">{item.name}</Link>
                          ) : (
                            <span className="font-medium">{item.name}</span>
                          )}
                          {!item.from_knowledge_base && <Badge tone="warn">General suggestion</Badge>}
                        </div>
                        <p className="text-xs text-muted">
                          {titleCase(item.type)} · until {item.end}
                          {item.duration_minutes != null && ` · ${minutes(item.duration_minutes)}${item.duration_estimated ? " (approx.)" : ""}`}
                          {" · Price: "}
                          {item.price ? item.price : <span className="italic">not available yet</span>}
                        </p>
                        {item.why && <p className="mt-0.5 text-sm text-muted">{item.why}</p>}
                        {item.tip && (
                          <p className="mt-2 flex gap-2 rounded-xl bg-value-soft px-3 py-2 text-sm">
                            <Lightbulb className="mt-0.5 size-4 shrink-0" />
                            <span><span className="font-semibold">Good to know: </span>{item.tip}</span>
                          </p>
                        )}
                        {item.location_id && <div className="mt-1.5"><SaveButtons placeId={item.location_id} /></div>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {(stay || home) && (
              <div className="flex flex-col gap-2 px-5 pb-4">
                {stay && <BlankSlot kind="stay" label="Hotel for tonight" />}
                {home && <BlankSlot kind="flight" label="Flight home" />}
              </div>
            )}
          </details>
        );
      })}
      {notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {notes.map((n) => <li key={n.message} className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" /> {n.message}</li>)}
        </ul>
      )}
    </div>
  );
}
