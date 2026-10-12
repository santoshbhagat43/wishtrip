"use client";

import { BookOpenCheck, ChevronDown, Globe, Info, Lightbulb, MessageCircleQuestion, PenLine, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

import { ItineraryView } from "@/components/chat/itinerary-view";
import { Badge, type Tone } from "@/components/ui/badge";
import type { ChatMessage, Suggestion } from "@/lib/api/client";
import { minutes, titleCase } from "@/lib/format";

const GROUNDING: Record<string, { label: string; tone: Tone; icon: typeof Globe }> = {
  knowledge_base: { label: "From WishTrip knowledge base", tone: "ok", icon: BookOpenCheck },
  partial: { label: "Partly general knowledge", tone: "warn", icon: Info },
  general: { label: "General knowledge — not in our knowledge base", tone: "warn", icon: Globe },
};

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <li className="rounded-2xl border border-border bg-surface p-3.5">
      <div className="flex flex-wrap-reverse items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1 basis-40">
          {s.location_id ? (
            <Link href={`/locations/${s.location_id}`} className="font-medium hover:text-brand">{s.name}</Link>
          ) : (
            <span className="font-medium">{s.name}</span>
          )}
          <p className="text-xs capitalize text-muted">
            {s.type}
            {s.time_of_day ? ` · ${s.time_of_day}` : ""}
            {s.duration_minutes != null ? ` · ${minutes(s.duration_minutes)}` : ""}
          </p>
        </div>
        {s.is_placeholder ? (
          <Badge tone="warn">Placeholder</Badge>
        ) : s.from_knowledge_base ? (
          <Badge tone="ok">Knowledge base</Badge>
        ) : (
          <Badge tone="warn">Not in KB</Badge>
        )}
      </div>
      {s.why && <p className="mt-2 text-sm text-muted">{s.why}</p>}
      {s.tip && (
        <p className="mt-2 flex gap-1.5 rounded-lg bg-value-soft px-2.5 py-1.5 text-xs">
          <Lightbulb className="mt-px size-3.5 shrink-0" /> {s.tip}
        </p>
      )}
      <p className="mt-2 text-xs">
        <span className="text-muted">Price: </span>
        {s.price ? <span className="font-medium">{s.price}</span> : <span className="italic text-muted">not available yet</span>}
      </p>
    </li>
  );
}

// The model cites knowledge-base records as [K3]; make each one a link to that record.
function linkCitations(message: ChatMessage) {
  const ids = new Map(message.sources.map((s) => [s.ref, s.location_id]));
  return message.content.replace(/\[(K\d+)\](?!\()/g, (match, ref: string) =>
    ids.has(ref) ? `[${ref}](/locations/${ids.get(ref)} "${ref}")` : match,
  );
}

function Citation({ href, title, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href?.startsWith("/locations/") && title && /^K\d+$/.test(title)) {
    return (
      <Link
        href={href}
        className="mx-0.5 inline-flex items-center rounded-md bg-brand-soft px-1.5 align-[1px] font-mono text-[10px] font-semibold text-brand no-underline hover:bg-brand hover:text-on-brand"
      >
        {children}
      </Link>
    );
  }
  return <a href={href} className="text-brand underline" target="_blank" rel="noreferrer">{children}</a>;
}

function Disclosure({ title, icon: Icon, children }: { title: string; icon: typeof Info; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted">
        <Icon className="size-3.5" /> {title}
        <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-3 py-2.5 text-xs">{children}</div>
    </details>
  );
}

/** An answer travels with its question ("> question\nanswer"): "Under 5" means nothing on its own. */
export function withQuestion(question: string, answer: string) {
  return `> ${question}\n${answer}`;
}

/** The traveler's message; an answer to one of our questions shows that question above it. */
export function UserBubble({ content }: { content: string }) {
  const match = content.match(/^> (.+)\n([\s\S]*)$/);
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-on-brand">
        {match && <p className="mb-1 border-l-2 border-on-brand/40 pl-2 text-xs text-on-brand/75">{match[1]}</p>}
        <p className="whitespace-pre-wrap">{match ? match[2] : content}</p>
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  onAnswer,
  onOwnAnswer,
  latest = false,
}: {
  message: ChatMessage;
  onAnswer: (question: string, answer: string) => void;
  onOwnAnswer: (question: string) => void;
  /** Only the newest reply's questions are still open. */
  latest?: boolean;
}) {
  const grounding = GROUNDING[message.grounding ?? "general"];
  const byDay = new Map<string, Suggestion[]>();
  for (const s of message.suggestions) {
    const key = s.day != null ? `Day ${s.day}` : "Suggestions";
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={grounding.tone}><grounding.icon className="size-3.5" /> {grounding.label}</Badge>
        <span className="flex items-center gap-1 text-xs text-muted">
          <Sparkles className="size-3" /> {message.model}
        </span>
      </div>
      <div className="prose-chat text-sm leading-relaxed">
        <ReactMarkdown components={{ a: Citation }}>{linkCitations(message)}</ReactMarkdown>
      </div>
      {message.feasibility && message.itinerary.length > 0 ? (
        <ItineraryView days={message.itinerary} feasibility={message.feasibility} />
      ) : (
        [...byDay.entries()].map(([day, items]) => (
        <div key={day}>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{day}</p>
          <ul className="grid gap-2 @xl:grid-cols-2">
            {items.map((s, i) => <SuggestionCard key={`${s.name}-${i}`} s={s} />)}
          </ul>
        </div>
        ))
      )}
      {latest && message.follow_ups.length > 0 && (
        <div className="rounded-2xl border border-border p-3.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <MessageCircleQuestion className="size-3.5" /> Questions for the traveler
          </p>
          <ul className="mt-2 space-y-2.5">
            {message.follow_ups.map((f) => (
              <li key={f.question}>
                <p className="text-sm font-medium">{f.question}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(f.answers ?? []).map((a) => (
                    <button key={a} type="button" onClick={() => onAnswer(f.question, a)} className="rounded-full border border-brand/40 px-3 py-1 text-xs text-brand hover:bg-brand-soft">
                      {a}
                    </button>
                  ))}
                  <button type="button" onClick={() => onOwnAnswer(f.question)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted hover:border-brand hover:text-brand">
                    <PenLine className="size-3" /> Type my own…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {message.validation_notes.length > 0 && (
          <Disclosure title={`Fact checks applied (${message.validation_notes.length})`} icon={ShieldCheck}>
            <ul className="list-disc space-y-1 pl-4">{message.validation_notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Disclosure>
        )}
        {message.sources.length > 0 && (
          <Disclosure title={`Knowledge base sources (${message.sources.length})`} icon={BookOpenCheck}>
            <ul className="space-y-1">
              {message.sources.map((src) => (
                <li key={src.ref} className="flex justify-between gap-3">
                  <span>
                    <span className="font-mono text-muted">{src.ref}</span>{" "}
                    <Link href={`/locations/${src.location_id}`} className="hover:text-brand">{src.name}</Link>{" "}
                    <span className="text-muted">· {titleCase(src.type)}{src.city ? ` · ${src.city}` : ""}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {src.score != null ? `score ${src.score.toFixed(2)}` : ""}
                    {src.similarity != null ? ` · sim ${src.similarity.toFixed(2)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {message.intent && (
          <Disclosure title="Understood intent" icon={Info}>
            <pre className="whitespace-pre-wrap font-mono">{JSON.stringify(message.intent, null, 2)}</pre>
          </Disclosure>
        )}
        {typeof message.debug?.context === "string" && (
          <Disclosure title="What the AI was given" icon={Info}>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">{message.debug.context}</pre>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
