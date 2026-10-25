"use client";

import { CalendarDays, MapPin, Ticket, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { gradientFor } from "@/components/trip/visuals";
import { Tabs } from "@/components/ui/tabs";
import type { ChatMessage, Schemas } from "@/lib/api/client";
import { COST_LABELS, titleCase, tripStateRows } from "@/lib/format";

import { GeneralItinerary } from "./general-itinerary";
import { Itinerary } from "./itinerary";

type Profile = Schemas["ProfileRead"];

/** What a plan item is, for the board's filter chips. */
export const KINDS = {
  all: { label: "All", types: null },
  todo: { label: "Things to do", types: ["attraction", "experience", "activity", "route"] },
  food: { label: "Food & drink", types: ["restaurant"] },
  stay: { label: "Stays", types: ["hotel"] },
  travel: { label: "Travel", types: ["flight"] },
} as const;
export type Kind = keyof typeof KINDS;

export function hasCheckedPlan(m: ChatMessage) {
  return !!m.feasibility && m.itinerary.length > 0;
}

export function hasGeneralPlan(m: ChatMessage) {
  return !hasCheckedPlan(m) && m.suggestions.some((s) => s.day != null);
}

/** Number of planned days in a reply (checked or general). */
export function planDays(m: ChatMessage) {
  if (hasCheckedPlan(m)) return m.itinerary.length;
  return new Set(m.suggestions.map((s) => s.day).filter((d) => d != null)).size;
}

/** The model usually opens with a heading; otherwise name the trip from what we know. */
export function planTitle(m: ChatMessage | null, state: Record<string, unknown>) {
  const heading = m?.content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, "").trim();
  if (heading && heading.length <= 80 && !/^day\s*\d/i.test(heading)) return heading;
  const where = typeof state.destination === "string" ? state.destination : null;
  const days = m ? planDays(m) : typeof state.duration_days === "number" ? state.duration_days : null;
  if (where && days) return `${days} days in ${where}`;
  return where ? `Your trip to ${where}` : "Your trip";
}

function dateRange(state: Record<string, unknown>, days: number) {
  if (typeof state.start_date !== "string") return null;
  const start = new Date(`${state.start_date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(days, 1) - 1);
  const fmt = (d: Date, year: boolean) =>
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  return days > 1 ? `${fmt(start, false)} – ${fmt(end, true)}` : fmt(start, true);
}

export function TripBoard({
  state,
  plan,
  showPlan,
  profile,
  savedCount,
}: {
  state: Record<string, unknown>;
  /** The reply whose plan the board shows (the latest one with a plan, unless one was picked). */
  plan: ChatMessage | null;
  /** On narrow screens the plan is shown inline in the chat instead. */
  showPlan: boolean;
  profile: Profile | undefined;
  savedCount: number;
}) {
  const [tab, setTab] = useState<"itinerary" | "info">("itinerary");
  const [kind, setKind] = useState<Kind>("all");
  const [bookingOpen, setBookingOpen] = useState(false);
  const destination = typeof state.destination === "string" ? state.destination : null;
  const days = plan ? planDays(plan) : typeof state.duration_days === "number" ? state.duration_days : 0;
  const dates = dateRange(state, days);
  const rows = tripStateRows(state);
  const companions = typeof state.companions === "string" ? titleCase(state.companions) : null;
  const show = KINDS[kind].types;

  return (
    <section aria-label="Trip board" className="flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-border bg-surface shadow-card xl:h-full">
      {/* Cover: the destination's colours (no licensed photography yet, so no stock images). */}
      <div
        className="relative flex min-h-36 shrink-0 flex-col justify-end p-5 text-white"
        style={{ background: gradientFor(destination ?? "WishTrip") }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
        <div className="relative">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/85">
            <MapPin className="size-3.5" /> {destination ?? "Plan a trip"}
          </p>
          <h2 className="mt-1 font-display text-2xl leading-tight">{planTitle(plan, state)}</h2>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/90">
            {dates && <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" /> {dates}</span>}
            {companions && <span className="inline-flex items-center gap-1.5"><Users className="size-4" /> {companions}</span>}
          </p>
        </div>
      </div>

      {/* What the assistant has understood, always in view. */}
      <aside aria-label="Your trip so far" className="shrink-0 border-b border-border px-5 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Your trip so far</h3>
        {rows.length === 0 ? (
          <p className="mt-1 text-sm text-muted">We&apos;ll fill this in as we understand your trip.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {rows.map(({ label, value }) => (
              <li key={label} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                <span className="text-muted">{label}: </span>
                <span className="font-medium">{value}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="shrink-0 px-5 pt-1">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "itinerary", label: "Itinerary" },
            { id: "info", label: "Trip info" },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "itinerary" &&
          (!showPlan ? (
            <p className="text-sm text-muted">Your plan is shown in the conversation.</p>
          ) : !plan ? (
            <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
              <p className="font-display text-lg">Your day-by-day plan appears here</p>
              <p className="mt-1 text-sm text-muted">Tell us where you&apos;d like to go — and for how long — and we&apos;ll lay it out day by day.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
                {(Object.keys(KINDS) as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={
                      kind === k
                        ? "rounded-full border border-brand bg-brand px-3 py-1 text-xs font-semibold text-on-brand"
                        : "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
                    }
                  >
                    {KINDS[k].label}
                  </button>
                ))}
              </div>
              {hasCheckedPlan(plan) ? (
                <Itinerary days={plan.itinerary} feasibility={plan.feasibility!} types={show} />
              ) : (
                <GeneralItinerary
                  suggestions={plan.suggestions}
                  startDate={typeof state.start_date === "string" ? state.start_date : null}
                  types={show}
                />
              )}
              <p className="rounded-2xl border border-border bg-surface-2/40 px-4 py-3 text-sm">
                <span className="font-semibold">Trip price: </span>
                <span className="italic text-muted">not available yet</span>
                <span className="block text-xs text-muted">
                  We&apos;re not connected to hotel, flight or activity partners yet, so we don&apos;t show prices we can&apos;t verify.
                </span>
              </p>
              <div>
                <button
                  onClick={() => setBookingOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-navy hover:bg-accent-strong"
                >
                  <Ticket className="size-4" /> Book this trip
                </button>
                {bookingOpen && (
                  <div role="dialog" aria-label="Booking" className="mt-3 rounded-2xl border border-border bg-surface p-4 text-sm shadow-raised">
                    <p className="font-semibold">Booking isn&apos;t live yet</p>
                    <p className="mt-1 text-muted">
                      We haven&apos;t connected live hotel, flight or activity inventory, so we can&apos;t show real prices or availability.
                      We won&apos;t show made-up ones. Save the places you like and we&apos;ll let you know when booking opens.
                    </p>
                    <button onClick={() => setBookingOpen(false)} className="mt-2 text-sm font-semibold text-brand">Got it</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        {tab === "info" && (
          <div className="flex flex-col gap-5 text-sm">
            <div>
              <h3 className="font-display text-lg">The trip</h3>
              {rows.length === 0 ? (
                <p className="mt-1 text-muted">Nothing yet.</p>
              ) : (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {rows.map(({ label, value }) => (
                    <div key={label} className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="break-words">{value}</dd></div>
                  ))}
                </dl>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg">From your profile</h3>
                <Link href="/profile" className="text-xs font-semibold text-brand">Edit</Link>
              </div>
              <ul className="mt-2 space-y-1 text-muted">
                <li>Travelling: <span className="capitalize text-text">{profile?.companions ?? "not set"}</span></li>
                <li>Budget: <span className="text-text">{profile?.budget_level != null ? COST_LABELS[profile.budget_level] : "not set"}</span></li>
                <li>Pace: <span className="text-text">{profile?.energy_level ? `${profile.energy_level}/5` : "not set"}</span></li>
                {profile?.accessibility_needs && <li className="text-text">Wheelchair-accessible places only</li>}
                <li>Saved places: <span className="text-text">{savedCount}</span></li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
