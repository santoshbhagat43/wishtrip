"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";

import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { api, unwrap } from "@/lib/api/client";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  waiting_customer: "Support replied",
  resolved: "Resolved",
};

const STATUS_TONE: Record<string, Tone> = {
  open: "brand",
  waiting_customer: "warn",
  resolved: "ok",
};

function formatWhen(value: string) {
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status.replaceAll("_", " ");
}

export default function HelpPage() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);

  const tickets = useQuery({
    queryKey: ["support-tickets"],
    queryFn: async () => unwrap(await api.GET("/support/tickets")),
  });
  const thread = useQuery({
    queryKey: ["support-ticket", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () =>
      unwrap(
        await api.GET("/support/tickets/{ticket_id}", {
          params: { path: { ticket_id: selectedId! } },
        }),
      ),
  });

  const selectedTicket = tickets.data?.find((t) => t.id === selectedId);

  function openTicket(id: string) {
    if (id === selectedId) return;
    setFollowUp("");
    setSelectedId(id);
  }

  function closeConversation() {
    setSelectedId(null);
    setFollowUp("");
  }

  const send = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/support/tickets", {
          body: { subject, body, channel: "in_app", in_destination: false },
        }),
      ),
    onSuccess: async (ticket) => {
      setSubject("");
      setBody("");
      // Keep the conversation closed — traveler opens a ticket explicitly.
      setSelectedId(null);
      setFollowUp("");
      setSubmitNotice(`Request #${ticket.number} sent — we'll get back to you.`);
      await queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });

  const reply = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/support/tickets/{ticket_id}/messages", {
          params: { path: { ticket_id: selectedId! } },
          body: { body: followUp },
        }),
      ),
    onSuccess: () => {
      setFollowUp("");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support-ticket", selectedId] });
    },
  });

  const conversation = selectedId ? (
    <div className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-border bg-surface shadow-card">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              #{selectedTicket?.number ?? thread.data?.number ?? "…"}
            </span>
            {(selectedTicket || thread.data) && (
              <Badge tone={STATUS_TONE[(selectedTicket ?? thread.data)!.status] ?? "neutral"}>
                {statusLabel((selectedTicket ?? thread.data)!.status)}
              </Badge>
            )}
          </div>
          <h3 className="mt-1 truncate text-base font-semibold leading-snug">
            {selectedTicket?.subject ?? thread.data?.subject ?? "Conversation"}
          </h3>
        </div>
        <button
          type="button"
          onClick={closeConversation}
          aria-label="Close conversation"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
        {thread.isLoading && <Spinner />}
        <ErrorNote error={thread.error} />
        {thread.data && (
          <ol className="flex list-none flex-col gap-3 p-0">
            {thread.data.messages.map((m) => {
              const mine = m.author === "customer";
              return (
                <li
                  key={m.id}
                  className={cn(
                    "rounded-2xl px-3.5 py-3 text-sm",
                    mine ? "bg-surface-2" : "bg-brand-soft",
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                    <span>{mine ? "You" : m.author_name || "Support"}</span>
                    <span className="ml-auto font-normal normal-case">{formatWhen(m.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {thread.data && thread.data.status !== "resolved" && (
        <form
          className="space-y-3 border-t border-border px-4 py-4 sm:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (followUp.trim()) reply.mutate();
          }}
        >
          <Field label="Follow up">
            <Textarea
              rows={3}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="Add more detail for support…"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="accent" disabled={reply.isPending || !followUp.trim()}>
              {reply.isPending ? "Sending…" : "Send follow-up"}
            </Button>
            <ErrorNote error={reply.error} />
          </div>
        </form>
      )}
    </div>
  ) : null;

  const ticketList = (
    <div className="rounded-[22px] border border-border bg-surface shadow-card">
      {tickets.isLoading && (
        <div className="px-4 py-6">
          <Spinner />
        </div>
      )}
      {tickets.error && (
        <div className="px-4 py-3">
          <ErrorNote error={tickets.error} />
        </div>
      )}
      {tickets.data?.length === 0 && (
        <p className="px-4 py-6 text-sm text-muted">No requests yet. Send one above and it will show up here.</p>
      )}
      {tickets.data && tickets.data.length > 0 && (
        <ul className="divide-y divide-border">
          {tickets.data.map((t) => {
            const selected = selectedId === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openTicket(t.id)}
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors sm:px-5",
                    selected
                      ? "bg-brand-soft/50 ring-inset ring-1 ring-brand/20"
                      : "hover:bg-surface-2",
                  )}
                >
                  <span className="mt-0.5 shrink-0 rounded-lg bg-surface-2 px-2 py-1 font-mono text-xs font-semibold text-muted">
                    #{t.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold leading-snug">{t.subject}</span>
                    <span className="mt-1 block text-xs text-muted">{formatWhen(t.updated_at)}</span>
                  </span>
                  <Badge tone={STATUS_TONE[t.status] ?? "neutral"} className="mt-0.5 shrink-0">
                    {statusLabel(t.status)}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-[34px] leading-tight">Help &amp; support</h1>
      <p className="mt-1 text-muted">Tell us what you need. A WishTrip support agent will pick it up.</p>

      <form
        className="mt-8 space-y-4 rounded-[22px] border border-border bg-surface p-6 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitNotice(null);
          if (subject.trim() && body.trim()) send.mutate();
        }}
      >
        <Field label="Subject">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            minLength={3}
            placeholder="e.g. Question about my Kerala trip"
          />
        </Field>
        <Field label="Message">
          <Textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            placeholder="Share the details…"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="accent" disabled={send.isPending || !subject.trim() || !body.trim()}>
            {send.isPending ? "Sending…" : "Send to support"}
          </Button>
          {submitNotice && <span className="text-sm text-ok">{submitNotice}</span>}
        </div>
        <ErrorNote error={send.error} />
      </form>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your recent requests</h2>
        <p className="mt-1 text-sm text-muted">Open a request to read replies and send a follow-up.</p>

        <div
          className={cn(
            "mt-4 grid gap-4",
            selectedId && "md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]",
          )}
        >
          <div className={cn(selectedId && "hidden md:block")}>{ticketList}</div>
          {selectedId && <div className="flex min-h-[28rem] flex-col">{conversation}</div>}
        </div>
      </section>
    </div>
  );
}
