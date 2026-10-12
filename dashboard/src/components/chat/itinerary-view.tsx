"use client";

import { AlertTriangle, CheckCircle2, Footprints, Info, Lightbulb, Wrench } from "lucide-react";
import Link from "next/link";

import { Badge, type Tone } from "@/components/ui/badge";
import type { Schemas } from "@/lib/api/client";
import { minutes, titleCase } from "@/lib/format";

type Day = Schemas["ItineraryDay"];
type Feasibility = Schemas["Feasibility"];

const STATUS: Record<string, { label: string; tone: Tone; icon: typeof Info }> = {
  feasible: { label: "Plan checked — it works", tone: "ok", icon: CheckCircle2 },
  repaired: { label: "Plan checked — adjusted to work", tone: "info", icon: Wrench },
  needs_attention: { label: "Plan check — needs attention", tone: "danger", icon: AlertTriangle },
};

function LoadBar({ day }: { day: Day }) {
  const used = day.activity_minutes + day.travel_minutes;
  const pct = Math.min(100, Math.round((used / day.capacity_minutes) * 100));
  return (
    <div className="flex items-center gap-2 text-xs text-muted" title="Activities + travel vs. what fits at this pace">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${used > day.capacity_minutes ? "bg-danger" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>
      {minutes(used)} of {minutes(day.capacity_minutes)}
    </div>
  );
}

export function ItineraryView({ days, feasibility }: { days: Day[]; feasibility: Feasibility }) {
  const status = STATUS[feasibility.status] ?? STATUS.feasible;
  const warnings = feasibility.issues.filter((i) => i.severity !== "info");
  const notes = feasibility.issues.filter((i) => i.severity === "info");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}><status.icon className="size-3.5" /> {status.label}</Badge>
      </div>
      {feasibility.changes.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-info-soft px-3 py-2 text-xs text-info">
          {feasibility.changes.map((c) => <li key={c}>• {c}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
          {warnings.map((w) => <li key={w.message}>⚠ {w.message}</li>)}
        </ul>
      )}
      {days.map((day) => (
        <section key={day.day} className="rounded-2xl border border-border bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">
              Day {day.day}
              {day.date && (
                <span className="ml-2 font-normal text-muted">
                  {new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                </span>
              )}
            </p>
            <LoadBar day={day} />
          </header>
          {day.items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Free day — nothing scheduled.</p>
          ) : (
            <ol className="px-4 py-2">
              {day.items.map((item, i) => (
                <li key={`${item.name}-${i}`}>
                  {i > 0 && item.travel_minutes_before > 0 && (
                    <p className="flex items-center gap-1.5 py-1 pl-14 text-xs text-muted">
                      <Footprints className="size-3" /> {minutes(item.travel_minutes_before)} travel
                      {item.travel_estimated && " (estimate)"}
                    </p>
                  )}
                  <div className="flex gap-3 py-1.5">
                    <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-brand">{item.start}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {item.location_id ? (
                          <Link href={`/locations/${item.location_id}`} className="text-sm font-medium hover:text-brand">{item.name}</Link>
                        ) : (
                          <span className="text-sm font-medium">{item.name}</span>
                        )}
                        {item.is_placeholder ? <Badge tone="warn">Placeholder</Badge> : !item.from_knowledge_base && <Badge tone="warn">Not in KB</Badge>}
                      </div>
                      <p className="text-xs text-muted">
                        {titleCase(item.type)} · {item.start}–{item.end}
                        {item.duration_minutes != null && ` · ${minutes(item.duration_minutes)}${item.duration_estimated ? " (estimate)" : ""}`}
                        {" · Price: "}
                        {item.price ? item.price : <span className="italic">not available yet</span>}
                      </p>
                      {item.why && <p className="mt-0.5 text-xs text-muted">{item.why}</p>}
                      {item.tip && (
                        <p className="mt-1.5 flex gap-1.5 rounded-lg bg-value-soft px-2.5 py-1.5 text-xs">
                          <Lightbulb className="mt-px size-3.5 shrink-0" />
                          <span><span className="font-semibold">Tip from WishTrip: </span>{item.tip}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
      {notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {notes.map((n) => <li key={n.message} className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" /> {n.message}</li>)}
        </ul>
      )}
    </div>
  );
}
