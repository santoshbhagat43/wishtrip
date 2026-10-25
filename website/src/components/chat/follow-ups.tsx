"use client";

import { MessageCircleQuestion, PenLine } from "lucide-react";

import type { Schemas } from "@/lib/api/client";

type FollowUp = Schemas["FollowUp"];

/**
 * An answer — tapped or typed — is sent with the question it answers, as "> question\nanswer",
 * so the model knows what "Under 5" or "the morning" refers to.
 */
export function withQuestion(question: string, answer: string) {
  return `> ${question}\n${answer}`;
}

export function splitQuestion(content: string): { question: string | null; answer: string } {
  const match = content.match(/^> (.+)\n([\s\S]*)$/);
  return match ? { question: match[1], answer: match[2] } : { question: null, answer: content };
}

/** The traveler's message; an answer to one of our questions shows that question above it. */
export function UserBubble({ content }: { content: string }) {
  const { question, answer } = splitQuestion(content);
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[16px] rounded-br-sm bg-navy px-4 py-3 text-[15px] leading-snug text-white">
        {question && <p className="mb-1 border-l-2 border-white/40 pl-2 text-xs text-white/75">{question}</p>}
        <p className="whitespace-pre-wrap">{answer}</p>
      </div>
    </div>
  );
}

/** Questions we ask the traveler, each with replies they can send in one tap. */
export function FollowUps({
  items,
  onAnswer,
  onOwnAnswer,
}: {
  items: FollowUp[];
  onAnswer: (question: string, answer: string) => void;
  onOwnAnswer: (question: string) => void;
}) {
  return (
    <div className="rounded-[16px] border border-border bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <MessageCircleQuestion className="size-3.5" /> A few questions to tailor your plan
      </p>
      <ul className="mt-2 space-y-3">
        {items.map((f) => (
          <li key={f.question}>
            <p className="text-sm font-medium">{f.question}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(f.answers ?? []).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onAnswer(f.question, a)}
                  className="rounded-full border border-accent bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-accent-text hover:bg-accent-soft"
                >
                  {a}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onOwnAnswer(f.question)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3.5 py-1.5 text-[13px] font-medium text-muted hover:border-brand hover:text-brand"
              >
                <PenLine className="size-3" /> Type my own…
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
