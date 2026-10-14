"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MapPin, MessageSquare, Plane, Send, StickyNote } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SupportTabs } from "@/components/support-tabs";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";
import { useMe } from "@/lib/hooks/use-me";

type View = "open" | "unassigned" | "mine" | "urgent" | "in_destination" | "resolved";
type Ticket = Schemas["TicketListItem"];

const VIEWS: { value: View; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "unassigned", label: "Unassigned" },
  { value: "mine", label: "Mine" },
  { value: "urgent", label: "Urgent" },
  { value: "in_destination", label: "In destination" },
  { value: "resolved", label: "Resolved" },
];

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-danger-soft text-danger",
  high: "bg-warn-soft text-warn",
  normal: "bg-surface-2 text-muted",
  low: "bg-surface-2 text-muted",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  waiting_customer: "Waiting on traveller",
  resolved: "Resolved",
};

function waitingLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

function initials(name: string) {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "··";
}

export default function SupportInboxPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [view, setView] = useState<View>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolveAfter, setResolveAfter] = useState(false);
  const canAssignAnyone = me?.role === "admin" || me?.role === "editor";

  const inbox = useQuery({
    queryKey: ["support-inbox", view],
    queryFn: async () => unwrap(await api.GET("/admin/support/inbox", { params: { query: { view } } })),
    refetchInterval: 10_000,
  });
  const agents = useQuery({
    queryKey: ["support-agents"],
    queryFn: async () => unwrap(await api.GET("/admin/support/agents")),
  });

  const currentId = selectedId ?? inbox.data?.items[0]?.id ?? null;
  const ticket = useQuery({
    queryKey: ["support-ticket", currentId],
    enabled: Boolean(currentId),
    queryFn: async () =>
      unwrap(await api.GET("/admin/support/tickets/{ticket_id}", { params: { path: { ticket_id: currentId! } } })),
    refetchInterval: 3_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["support-inbox"] });
    queryClient.invalidateQueries({ queryKey: ["support-ticket"] });
  };

  const send = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/admin/support/tickets/{ticket_id}/reply", {
          params: { path: { ticket_id: currentId! } },
          body: { body: draft, internal, resolve: resolveAfter },
        }),
      ),
    onSuccess: () => {
      setDraft("");
      setResolveAfter(false);
      refresh();
    },
  });

  const change = useMutation({
    mutationFn: async (body: Schemas["TicketUpdate"]) =>
      unwrap(
        await api.PATCH("/admin/support/tickets/{ticket_id}", {
          params: { path: { ticket_id: currentId! } },
          body,
        }),
      ),
    onSuccess: refresh,
  });

  if (inbox.isLoading) return <Spinner />;
  if (inbox.error) return <ErrorNote error={inbox.error} />;

  const data = inbox.data!;
  const current = ticket.data;
  const context = current?.context;

  return (
    <div className="mx-auto flex max-w-[1340px] flex-col gap-5">
      <PageHeader
        breadcrumb="Support"
        title="Inbox"
        description="Every traveller waiting on a person. Someone already in destination comes first, then urgency, then whoever has waited longest."
        action={
          <HeaderStats
            items={[
              { value: data.counts.open, label: "open" },
              { value: data.counts.urgent, label: "urgent", tone: data.counts.urgent ? "text-danger" : "text-text" },
              {
                value: data.median_first_reply_minutes == null ? "—" : `${data.median_first_reply_minutes} min`,
                label: "median first reply",
              },
            ]}
          />
        }
      />

      <SupportTabs />

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Tickets" className="flex min-w-0 flex-[1_1_330px] flex-col gap-2.5">
          <div role="group" aria-label="View" className="flex flex-wrap gap-1 self-start rounded-full bg-surface-2 p-1">
            {VIEWS.map((v) => {
              const count = data.counts[v.value as keyof typeof data.counts] ?? 0;
              const active = v.value === view;
              return (
                <button
                  key={v.value}
                  aria-pressed={active}
                  onClick={() => {
                    setView(v.value);
                    setSelectedId(null);
                  }}
                  className={`h-[38px] rounded-full px-3.5 text-[13px] font-bold transition-colors ${
                    active ? "bg-brand text-on-brand" : "text-muted hover:text-text"
                  }`}
                >
                  {v.label} <span className="tabular-nums opacity-80">{count}</span>
                </button>
              );
            })}
          </div>

          <ul className="flex max-h-[70vh] list-none flex-col gap-2 overflow-y-auto p-0">
            {data.items.map((t: Ticket) => {
              const picked = current?.id === t.id;
              const mine = Boolean(me?.id && t.assignee?.id === me.id);
              return (
                <li key={t.id}>
                  <button
                    aria-pressed={picked}
                    onClick={() => setSelectedId(t.id)}
                    className={`flex w-full cursor-pointer flex-col gap-1.5 rounded-[18px] border px-4 py-3.5 text-left shadow-card transition-colors ${
                      picked
                        ? "border-brand bg-brand-soft/50"
                        : mine
                          ? "border-accent/50 bg-accent/5 hover:border-accent/70"
                          : "border-border bg-surface hover:border-brand/40"
                    }`}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className={`rounded-full px-2 py-px text-[10.5px] font-extrabold uppercase ${PRIORITY_TONE[t.priority]}`}>
                        {t.priority}
                      </span>
                      {t.in_destination && (
                        <span className="flex items-center gap-1 rounded-full bg-danger-soft px-2 py-px text-[10.5px] font-extrabold text-danger">
                          <MapPin className="size-3" /> In destination
                        </span>
                      )}
                      {mine && (
                        <span className="rounded-full bg-accent/15 px-2 py-px text-[10.5px] font-extrabold text-accent">
                          Assigned to you
                        </span>
                      )}
                      <span className="ml-auto text-xs tabular-nums text-muted/80">#{t.number}</span>
                    </span>
                    <span className="text-[15px] font-bold leading-tight">{t.subject}</span>
                    <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                      <span>{t.user.full_name || t.user.email}</span>
                      <span aria-hidden>·</span>
                      <span className={mine ? "font-semibold text-accent" : undefined}>
                        {t.assignee ? t.assignee.full_name || t.assignee.email : "Unassigned"}
                      </span>
                      {t.trip_title && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{t.trip_title}</span>
                        </>
                      )}
                      <span className="ml-auto tabular-nums">waiting {waitingLabel(t.waiting_minutes)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {data.items.length === 0 && (
            <div className="rounded-[18px] border border-border bg-surface p-7 text-center text-sm text-muted">
              Nothing in this view.
            </div>
          )}
        </section>

        {current && (
          <Card className="flex min-w-0 flex-[999_1_460px] flex-col gap-5 p-6">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                  #{current.number} · {titleCase(current.channel)}
                  {current.in_destination ? " · In destination" : ""}
                </span>
                <h2 className="font-display break-words text-[26px] leading-[1.15]">{current.subject}</h2>
                <span className="text-[13px] text-muted">
                  {current.user.full_name || current.user.email} · opened {relativeTime(current.created_at)}
                  {current.first_response_at ? ` · first reply ${relativeTime(current.first_response_at)}` : " · no reply yet"}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                <select
                  aria-label="Status"
                  value={current.status}
                  onChange={(e) => change.mutate({ status: e.target.value as Schemas["TicketStatus"] })}
                  className="h-9 rounded-full border border-border bg-surface px-3 text-[13px] font-bold"
                >
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {canAssignAnyone ? (
                  <select
                    aria-label="Assignee"
                    value={current.assignee?.id ?? ""}
                    onChange={(e) => change.mutate({ assignee_id: e.target.value || null })}
                    className="h-9 rounded-full border border-border bg-surface px-3 text-[13px]"
                  >
                    <option value="">Unassigned</option>
                    {(agents.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.full_name} ({a.open_tickets})
                      </option>
                    ))}
                  </select>
                ) : current.assignee?.id === me?.id ? (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-[13px] font-semibold text-accent">
                    Assigned to you
                  </span>
                ) : current.assignee ? (
                  <span className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-muted">
                    Assigned to {current.assignee.full_name || current.assignee.email}
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!me?.id || change.isPending}
                    onClick={() => me?.id && change.mutate({ assignee_id: me.id })}
                  >
                    Take ticket
                  </Button>
                )}
              </div>
            </div>

            <ol className="flex list-none flex-col gap-3 p-0">
              {current.messages.map((m) => {
                const mine = m.author !== "customer";
                return (
                  <li
                    key={m.id}
                    className={`flex flex-col gap-1 rounded-2xl px-4 py-3 ${
                      m.author === "note"
                        ? "border border-dashed border-warn/40 bg-warn-soft/50"
                        : mine
                          ? "bg-brand-soft"
                          : "bg-surface-2"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">
                      {m.author === "note" ? <StickyNote className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                      {m.author === "note" ? "Internal note" : m.author_name}
                      <span className="ml-auto font-normal normal-case">{relativeTime(m.created_at)}</span>
                    </span>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder={internal ? "A note only staff can see…" : "Reply to the traveller…"}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal
                  note
                </label>
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={resolveAfter}
                    disabled={internal}
                    onChange={(e) => setResolveAfter(e.target.checked)}
                  />{" "}
                  Resolve after sending
                </label>
                <button
                  disabled={!draft.trim() || send.isPending}
                  onClick={() => send.mutate()}
                  className="ml-auto flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-white transition-colors hover:bg-accent-strong disabled:opacity-50"
                >
                  {internal ? <StickyNote className="size-4" /> : <Send className="size-4" />}
                  {internal ? "Save note" : resolveAfter ? "Send and resolve" : "Send reply"}
                </button>
              </div>
              <ErrorNote error={send.error ?? change.error} />
            </div>
          </Card>
        )}

        {context && current && (
          <aside className="flex min-w-0 flex-[1_1_290px] flex-col gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-[38px] flex-none items-center justify-center rounded-full bg-brand text-[13px] font-bold text-on-brand">
                  {initials(current.user.full_name || current.user.email)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{current.user.full_name || "Traveller"}</p>
                  <p className="truncate text-xs text-muted">{current.user.email}</p>
                </div>
              </div>
              <dl className="mt-4 flex flex-col gap-2 text-[13px]">
                {[
                  ["Travelling as", context.companions ? titleCase(context.companions) : "Not set"],
                  ["Pace", context.energy_level ? `${context.energy_level} of 5` : "Not set"],
                  ["Budget", context.budget_level == null ? "Not set" : `Level ${context.budget_level}`],
                  ["Saved places", String(context.saved_places)],
                  ["Trips planned", String(context.trips_planned)],
                  ["Past tickets", String(context.past_tickets)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-right">{value}</dd>
                  </div>
                ))}
              </dl>
              {context.accessibility_needs && (
                <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
                  Wheelchair-accessible places only — a hard constraint on their plans.
                </p>
              )}
              {context.interests.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {context.interests.map((tag) => (
                    <span key={tag} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11.5px]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">The trip they&apos;re asking about</p>
              {current.trip_title ? (
                <>
                  <p className="mt-1.5 font-display text-lg leading-tight">{current.trip_title}</p>
                  <p className="mt-1 text-[13px] text-muted">
                    {[
                      context.destination,
                      context.duration_days ? `${context.duration_days} days` : null,
                      context.start_date,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No trip details captured yet"}
                  </p>
                  {context.itinerary.length > 0 ? (
                    <ol className="mt-3 flex list-none flex-col gap-2 p-0">
                      {context.itinerary.map((day) => (
                        <li key={String(day.day)} className="rounded-xl bg-surface-2 px-3 py-2">
                          <p className="text-[11.5px] font-bold uppercase tracking-wide text-muted">Day {String(day.day)}</p>
                          <ul className="mt-1 flex list-none flex-col gap-0.5 p-0 text-[13px]">
                            {(day.items as { name: string; start?: string }[]).map((item, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="tabular-nums text-muted">{item.start ?? "—"}</span>
                                <span className="truncate">{item.name}</span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-3 text-[13px] text-muted">No checked plan on this conversation yet.</p>
                  )}
                  <Link href="/chat" className="mt-3 inline-block text-[13px] font-bold">
                    Open trip chat
                  </Link>
                </>
              ) : (
                <p className="mt-1.5 text-[13px] text-muted">
                  This ticket isn&apos;t linked to a trip conversation.
                </p>
              )}
            </Card>

            <Card className="flex items-start gap-2.5 p-5 text-[13px] text-muted">
              <Plane className="mt-0.5 size-4 shrink-0" />
              <span>
                Bookings, payments and refunds would sit here. There is no booking rail yet, so nothing is shown rather
                than something invented.
              </span>
            </Card>

            {current.status === "resolved" && (
              <p className="flex items-center gap-2 text-[13px] text-ok">
                <CheckCircle2 className="size-4" /> Resolved {current.updated_at ? relativeTime(current.updated_at) : ""}
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
