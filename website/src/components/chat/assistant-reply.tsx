"use client";

import { ArrowRight, BookOpenCheck, CalendarDays, Globe, Info, Lightbulb, PanelRight, Sparkles, Ticket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

import { Badge, type Tone } from "@/components/ui/badge";
import type { ChatMessage } from "@/lib/api/client";
import { minutes, titleCase } from "@/lib/format";

import { FollowUps } from "./follow-ups";
import { GeneralItinerary } from "./general-itinerary";
import { Itinerary } from "./itinerary";
import { hasCheckedPlan, hasGeneralPlan, planDays } from "./trip-board";

const GROUNDING: Record<string, { label: string; tone: Tone; icon: typeof Globe }> = {
  knowledge_base: { label: "From places WishTrip has checked", tone: "ok", icon: BookOpenCheck },
  partial: { label: "Includes some general suggestions", tone: "warn", icon: Info },
  general: { label: "General ideas — not from our checked places", tone: "warn", icon: Globe },
};

const CHECK: Record<string, string> = {
  feasible: "Checked — it works",
  repaired: "Checked — adjusted to work",
  needs_attention: "Checked — some days are too full",
};

/** On wide screens the plan lives on the trip board; the chat keeps a compact card for it. */
function PlanCard({ message, onBoard, onShow }: { message: ChatMessage; onBoard: boolean; onShow: () => void }) {
  const checked = hasCheckedPlan(message);
  const days = planDays(message);
  const byDay = checked
    ? message.itinerary.map((d) => ({ day: d.day, names: d.items.map((i) => i.name) }))
    : [...new Set(message.suggestions.map((s) => s.day).filter((d): d is number => d != null))]
        .sort((a, b) => a - b)
        .map((day) => ({
          day,
          names: message.suggestions.filter((s) => s.day === day && !s.is_placeholder).map((s) => s.name),
        }));
  return (
    <div className="rounded-2xl border border-border bg-surface-2/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <CalendarDays className="size-4 text-brand" /> {days}-day plan
        </p>
        <Badge tone={checked ? "ok" : "warn"}>
          {checked ? CHECK[message.feasibility!.status] ?? "Checked" : "General plan — not checked yet"}
        </Badge>
      </div>
      <ol className="mt-2 space-y-1 text-sm">
        {byDay.slice(0, 7).map(({ day, names }) => (
          <li key={day} className="flex gap-2">
            <span className="w-12 shrink-0 text-muted">Day {day}</span>
            <span className="min-w-0 truncate">{names.length ? names.join(" · ") : "Free day"}</span>
          </li>
        ))}
      </ol>
      {onBoard ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand">
          <PanelRight className="size-3.5" /> Showing on your trip board
        </p>
      ) : (
        <button onClick={onShow} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline">
          Show on trip board <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function AssistantReply({
  message,
  onAnswer,
  onOwnAnswer,
  latest = false,
  startDate,
  wide = false,
  onBoard = false,
  onShowOnBoard,
}: {
  message: ChatMessage;
  /** Send a ready-made answer to one of the reply's questions. */
  onAnswer: (question: string, answer: string) => void;
  /** Start typing an answer to this question. */
  onOwnAnswer: (question: string) => void;
  /** Only the newest reply's questions are still open. */
  latest?: boolean;
  /** Day 1 of the trip, when the traveler gave dates — puts dates on a general plan's days. */
  startDate?: string | null;
  /** Wide layout: plans are shown on the trip board, so the chat shows a compact card. */
  wide?: boolean;
  /** This reply's plan is the one on the board. */
  onBoard?: boolean;
  onShowOnBoard?: () => void;
}) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const grounding = GROUNDING[message.grounding ?? "general"];
  const checked = hasCheckedPlan(message);
  // A plan we couldn't check (a destination we don't hold yet) still reads day by day.
  const general = hasGeneralPlan(message);
  const inlinePlan = (checked || general) && !wide;
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand sm:flex">
        <Sparkles className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Badge tone={grounding.tone} className="self-start"><grounding.icon className="size-3.5" /> {grounding.label}</Badge>
        <div className="prose-chat text-[15px] leading-relaxed"><ReactMarkdown>{message.content}</ReactMarkdown></div>
        {(checked || general) && wide ? (
          <PlanCard message={message} onBoard={onBoard} onShow={() => onShowOnBoard?.()} />
        ) : checked ? (
          <Itinerary days={message.itinerary} feasibility={message.feasibility!} />
        ) : general ? (
          <GeneralItinerary suggestions={message.suggestions} startDate={startDate} />
        ) : (
          message.suggestions.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {message.suggestions.map((s, i) => (
                <li key={`${s.name}-${i}`} className="rounded-2xl border border-border bg-surface p-3.5">
                  {s.location_id ? <Link href={`/places/${s.location_id}`} className="font-medium hover:text-brand">{s.name}</Link> : <span className="font-medium">{s.name}</span>}
                  <p className="text-xs text-muted">{titleCase(s.type)}{s.duration_minutes != null ? ` · ${minutes(s.duration_minutes)}` : ""} · Price: {s.price ?? <span className="italic">not available yet</span>}</p>
                  {s.why && <p className="mt-1 text-sm text-muted">{s.why}</p>}
                  {s.tip && (
                    <p className="mt-2 flex gap-2 rounded-xl bg-value-soft px-3 py-2 text-sm">
                      <Lightbulb className="mt-0.5 size-4 shrink-0" /> {s.tip}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
        {latest && message.follow_ups.length > 0 && (
          <FollowUps items={message.follow_ups} onAnswer={onAnswer} onOwnAnswer={onOwnAnswer} />
        )}
        {inlinePlan && (
          <div>
            <button onClick={() => setBookingOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-navy hover:bg-accent-strong">
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
        )}
      </div>
    </div>
  );
}
