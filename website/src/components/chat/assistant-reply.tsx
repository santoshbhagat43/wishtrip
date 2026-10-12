"use client";

import { BookOpenCheck, Globe, Info, Lightbulb, Ticket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

import { Badge, type Tone } from "@/components/ui/badge";
import type { ChatMessage } from "@/lib/api/client";
import { minutes, titleCase } from "@/lib/format";

import { Itinerary } from "./itinerary";

const GROUNDING: Record<string, { label: string; tone: Tone; icon: typeof Globe }> = {
  knowledge_base: { label: "From places WishTrip has checked", tone: "ok", icon: BookOpenCheck },
  partial: { label: "Includes some general suggestions", tone: "warn", icon: Info },
  general: { label: "General ideas — not from our checked places", tone: "warn", icon: Globe },
};

export function AssistantReply({ message, onFollowUp }: { message: ChatMessage; onFollowUp: (q: string) => void }) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const grounding = GROUNDING[message.grounding ?? "general"];
  const hasPlan = !!message.feasibility && message.itinerary.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <Badge tone={grounding.tone} className="self-start"><grounding.icon className="size-3.5" /> {grounding.label}</Badge>
      <div className="prose-chat text-[15px] leading-relaxed"><ReactMarkdown>{message.content}</ReactMarkdown></div>
      {hasPlan ? (
        <Itinerary days={message.itinerary} feasibility={message.feasibility!} />
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
      {message.follow_ups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.follow_ups.map((q) => (
            <button key={q} onClick={() => onFollowUp(q)} className="rounded-full border border-brand/40 px-3 py-1 text-xs font-medium text-brand hover:bg-brand-soft">{q}</button>
          ))}
        </div>
      )}
      {hasPlan && (
        <div>
          <button onClick={() => setBookingOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong">
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
  );
}
