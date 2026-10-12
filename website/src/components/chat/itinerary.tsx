"use client";

import { AlertTriangle, CheckCircle2, Footprints, Info, Lightbulb, Wrench } from "lucide-react";
import Link from "next/link";

import { SaveButtons } from "@/components/trip/place-card";
import { Badge, type Tone } from "@/components/ui/badge";
import type { Schemas } from "@/lib/api/client";
import { minutes, titleCase } from "@/lib/format";

type Day = Schemas["ItineraryDay"];
type Feasibility = Schemas["Feasibility"];

const STATUS: Record<string, { label: string; tone: Tone; icon: typeof Info }> = {
  feasible: { label: "Checked — this plan works", tone: "ok", icon: CheckCircle2 },
  repaired: { label: "Checked — we adjusted it so it works", tone: "info", icon: Wrench },
  needs_attention: { label: "Checked — some days are too full", tone: "danger", icon: AlertTriangle },
};

export function Itinerary({ days, feasibility }: { days: Day[]; feasibility: Feasibility }) {
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
        return (
          <section key={day.day} className="rounded-[22px] border border-border bg-surface shadow-card">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <p className="font-display text-lg">
                Day {day.day}
                {day.date && <span className="ml-2 font-sans text-sm text-muted">{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</span>}
              </p>
              <span className="text-xs text-muted">{minutes(used)} planned · fits {minutes(day.capacity_minutes)} at your pace</span>
            </header>
            {day.items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">A free day to wander.</p>
            ) : (
              <ol className="px-5 py-3">
                {day.items.map((item, i) => (
                  <li key={`${item.name}-${i}`}>
                    {i > 0 && item.travel_minutes_before > 0 && (
                      <p className="flex items-center gap-1.5 py-1 pl-16 text-xs text-muted">
                        <Footprints className="size-3" /> about {minutes(item.travel_minutes_before)} to get there{item.travel_estimated ? " (estimate)" : ""}
                      </p>
                    )}
                    <div className="flex gap-4 py-2">
                      <span className="w-12 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-brand">{item.start}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.location_id ? (
                            <Link href={`/places/${item.location_id}`} className="font-medium hover:text-brand">{item.name}</Link>
                          ) : (
                            <span className="font-medium">{item.name}</span>
                          )}
                          {item.is_placeholder && <Badge tone="warn">Sample — live options coming soon</Badge>}
                          {!item.is_placeholder && !item.from_knowledge_base && <Badge tone="warn">General suggestion</Badge>}
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
          </section>
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
