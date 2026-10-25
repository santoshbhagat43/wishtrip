"use client";

import { MapPin, Ticket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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
  building = false,
}: {
  state: Record<string, unknown>;
  /** The reply whose plan the board shows (the latest one with a plan, unless one was picked). */
  plan: ChatMessage | null;
  /** On narrow screens the plan is shown inline in the chat instead. */
  showPlan: boolean;
  profile: Profile | undefined;
  savedCount: number;
  /** Arya is working on a reply right now. */
  building?: boolean;
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
  const title = destination ? `Your ${destination} trip` : "Your trip";
  const subtitle = plan
    ? [planTitle(plan, state), dates, companions].filter(Boolean).join(" · ")
    : destination
      ? "Dates and details still to come"
      : "Tell Arya where, when and who";

  return (
    <section aria-label="Trip board" className="flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-border bg-surface lg:h-full">
      <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 flex-none place-items-center rounded-xl bg-accent-soft text-brand">
            <MapPin className="size-5" />
          </span>
          <div className="min-w-0 leading-tight">
            <h2 className="font-sans! m-0 truncate text-[17px] font-bold">{title}</h2>
            <p className="m-0 mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>
          </div>
        </div>
        <span className={`inline-flex flex-none items-center gap-1.5 text-[12.5px] font-bold ${building ? "text-ok" : "text-muted"}`} aria-live="polite">
          <span className={`size-2 rounded-full ${building ? "animate-pulse bg-ok" : plan ? "bg-ok" : "bg-border"}`} />
          {building ? "Building live" : plan ? "Plan ready" : "Waiting for you"}
        </span>
      </header>

      {/* What Arya has understood so far, always in view. */}
      <aside aria-label="What Arya knows" className="shrink-0 px-5 pb-4">
        <h3 className="m-0 text-[12.5px] font-semibold text-muted">What Arya knows</h3>
        {rows.length === 0 ? (
          <p className="m-0 mt-1.5 text-sm text-muted">She&apos;ll fill this in as she learns about your trip.</p>
        ) : (
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
            {rows.map(({ label, value }) => (
              <li key={label} title={label} className="rounded-full bg-accent-soft px-3 py-1.5 text-[12.5px] font-semibold text-accent-text">
                {value}
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
            <div className="flex flex-col gap-2.5">
              <h3 className="m-0 text-[12.5px] font-semibold text-muted">Coming up on your board</h3>
              {(
                [
                  ["Day by day", "Arya lays it out once she knows where, for how long and who is coming"],
                  ["Places she has checked", "Only places WishTrip has checked, each with its tips"],
                  ["Good to know", "Opening hours, travel times and what to book ahead"],
                ] as const
              ).map(([name, note]) => (
                <div key={name} className="rounded-[14px] border border-dashed border-[#D9D4C7] px-4 py-3">
                  <p className="m-0 text-[14px] font-bold">{name}</p>
                  <p className="m-0 text-[13px] text-muted">{note}</p>
                </div>
              ))}
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
