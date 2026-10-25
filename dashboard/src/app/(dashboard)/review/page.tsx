"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, CheckCircle2, Info, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Card, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { minutes, relativeTime, titleCase } from "@/lib/format";

type Reason = Schemas["ReviewReason"];
type Item = Schemas["ReviewItem"];

const FILTERS: { value: Reason | "all"; label: string; note: string }[] = [
  { value: "unverified", label: "To verify", note: "Imported, not yet checked by a person." },
  { value: "draft", label: "Drafts", note: "Hidden from travellers until someone publishes them." },
  { value: "incomplete", label: "Gaps", note: "Published, but short of what the trip engine plans from." },
  { value: "stale_index", label: "Index", note: "Edited since they were last indexed for search." },
  { value: "all", label: "All", note: "Everything waiting for a person." },
];

const COST_LABELS = ["Free", "Cheap", "Moderate", "Pricey", "Luxury"];

/** The facts the planner reads off a record, in the order the review table shows them. */
const FACTS: { field: string; label: string; read: (l: Schemas["LocationRead"]) => string }[] = [
  { field: "summary", label: "Summary", read: (l) => l.summary },
  { field: "duration", label: "How long it takes", read: (l) => (l.duration_minutes ? minutes(l.duration_minutes) : "") },
  { field: "best time", label: "Best time of day", read: (l) => l.best_times.join(", ") },
  { field: "cost", label: "Cost level", read: (l) => (l.cost_level == null ? "" : COST_LABELS[l.cost_level]) },
  { field: "energy level", label: "Energy level", read: (l) => (l.energy_level ? `${l.energy_level} of 5` : "") },
  {
    field: "suitability",
    label: "Who it suits",
    read: (l) =>
      [l.family_friendly && "families", l.couple_friendly && "couples", l.accessible && "wheelchair users"]
        .filter(Boolean)
        .join(", "),
  },
  { field: "pros", label: "Why go", read: (l) => l.pros.join(" · ") },
  { field: "description", label: "Description", read: (l) => l.description },
  {
    field: "coordinates",
    label: "Coordinates",
    read: (l) => (l.latitude == null || l.longitude == null ? "" : `${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}`),
  },
  { field: "tags", label: "Tags", read: (l) => l.tags.map((t) => t.name).join(", ") },
];

export default function ReviewQueuePage() {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<Reason | "all">("unverified");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["review-queue", reason],
    queryFn: async () =>
      unwrap(
        await api.GET("/admin/review-queue", {
          params: { query: { ...(reason === "all" ? {} : { reason }), page_size: 50 } },
        }),
      ),
  });

  const act = useMutation({
    mutationFn: async ({ item, body }: { item: Item; body: Schemas["LocationUpdate"]; done: string }) =>
      unwrap(await api.PATCH("/admin/locations/{location_id}", { params: { path: { location_id: item.id } }, body })),
    onSuccess: (_data, variables) => {
      setToast(variables.done);
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const detail = useQuery({
    queryKey: ["location", selectedId ?? queue.data?.items[0]?.id],
    enabled: Boolean(selectedId ?? queue.data?.items[0]?.id),
    queryFn: async () =>
      unwrap(
        await api.GET("/admin/locations/{location_id}", {
          params: { path: { location_id: (selectedId ?? queue.data!.items[0].id)! } },
        }),
      ),
  });

  if (queue.isLoading) return <Spinner />;
  if (queue.error) return <ErrorNote error={queue.error} />;

  const q = queue.data!;
  const waiting = Object.values(q.counts).reduce((a, b) => a + b, 0);
  const current = q.items.find((i) => i.id === selectedId) ?? q.items[0];
  const activeFilter = FILTERS.find((f) => f.value === reason)!;

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <PageHeader
        breadcrumb="Content"
        title="Review queue"
        description="Records waiting on a person. The trip engine starts using a record the moment you publish it, so check each fact against its source."
        action={
          <HeaderStats
            items={[
              { value: waiting, label: "waiting" },
              { value: q.counts.unverified, label: "to verify" },
              {
                value: q.oldest_updated_at ? relativeTime(q.oldest_updated_at) : "—",
                label: "oldest",
                tone: "text-warn",
              },
            ]}
          />
        }
      />

      {toast && (
        <div role="status" className="flex items-center gap-3 rounded-2xl bg-ok-soft px-[18px] py-3.5 text-sm font-semibold text-ok">
          <CheckCircle2 className="size-4" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-bold text-ok">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Waiting for review" className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5">
          <div role="group" aria-label="Filter" className="flex flex-wrap gap-1 self-start rounded-full bg-surface-2 p-1">
            {FILTERS.map((f) => {
              const count = f.value === "all" ? waiting : (q.counts[f.value] ?? 0);
              const active = f.value === reason;
              return (
                <button
                  key={f.value}
                  aria-pressed={active}
                  onClick={() => {
                    setReason(f.value);
                    setSelectedId(null);
                  }}
                  className={`h-[38px] rounded-full px-3.5 text-[13px] font-bold transition-colors ${
                    active ? "bg-brand text-on-brand" : "text-muted hover:text-text"
                  }`}
                >
                  {f.label} <span className="tabular-nums opacity-80">{count}</span>
                </button>
              );
            })}
          </div>
          <p className="px-1 text-[12.5px] text-muted">{activeFilter.note}</p>

          <ul className="flex max-h-[68vh] list-none flex-col gap-2 overflow-y-auto p-0">
            {q.items.map((item) => {
              const picked = current?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    aria-pressed={picked}
                    onClick={() => setSelectedId(item.id)}
                    className={`flex w-full cursor-pointer flex-col gap-1.5 rounded-[18px] border px-4 py-3.5 text-left shadow-card transition-colors ${
                      picked ? "border-brand bg-brand-soft/50" : "border-border bg-surface hover:border-brand/40"
                    }`}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="text-[11.5px] font-extrabold text-muted">
                        {titleCase(item.type)} · {item.parent?.name ?? item.region ?? "—"}
                      </span>
                      {item.status === "draft" && (
                        <span className="rounded-full bg-brand-soft px-[7px] py-px text-[10.5px] font-extrabold text-brand">
                          Not live
                        </span>
                      )}
                      <span className="ml-auto text-xs tabular-nums text-muted/80">{relativeTime(item.updated_at)}</span>
                    </span>
                    <span className="text-[15px] font-bold leading-tight">{item.name}</span>
                    <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                      <span>{item.source === "manual" ? "Added by staff" : "Client KB"}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{Math.round(item.completeness * 100)}% complete</span>
                      {item.missing_fields.slice(0, 2).map((f) => (
                        <span key={f} className="rounded-full bg-warn-soft px-2 py-px text-[11px] font-bold text-warn">
                          {f}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {q.items.length === 0 && (
            <div className="rounded-[18px] border border-border bg-surface p-7 text-center text-sm text-muted">
              Nothing waiting here.
            </div>
          )}
          {q.total > q.items.length && (
            <span className="px-1 text-[12.5px] tabular-nums text-muted/80">
              Showing {q.items.length} of {q.total} — oldest first
            </span>
          )}
        </section>

        {current && (
          <Card className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                  {[titleCase(current.type), current.parent?.name, current.region].filter(Boolean).join(" · ")}
                </span>
                <h2 className="font-display text-[26px] leading-[1.15]">{current.name}</h2>
                <span className="text-[13px] text-muted">
                  {current.source === "manual" ? "Added by staff" : "Imported from the client knowledge base"} · last
                  changed {relativeTime(current.updated_at)} ·{" "}
                  <Link href={`/locations/${current.id}`} className="font-bold no-underline">
                    Open record
                  </Link>
                </span>
              </div>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold tabular-nums text-muted">
                {Math.round(current.completeness * 100)}% complete
              </span>
            </div>

            {current.reference_keys.length > 0 && (
              <div className="flex gap-2.5 rounded-2xl bg-surface-2 px-3.5 py-3 text-[13.5px] leading-normal">
                <Info className="size-4 shrink-0 text-muted" />
                <span>
                  <strong>Staff-only reference data:</strong> {current.reference_keys.join(", ")}. Unverified, so it never
                  reaches a traveller and is never sent to the AI.
                </span>
              </div>
            )}

            <div className="flex flex-col overflow-hidden rounded-[18px] border border-border">
              <div className="grid grid-cols-[minmax(130px,.8fr)_minmax(0,1fr)_92px] gap-3 bg-surface-2 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                <span>Field</span>
                <span>What we hold</span>
                <span className="text-right">State</span>
              </div>
              {FACTS.map((fact) => {
                const missing = current.missing_fields.includes(fact.field);
                const value = detail.data && detail.data.id === current.id ? fact.read(detail.data) : "";
                return (
                  <div
                    key={fact.field}
                    className="grid grid-cols-[minmax(130px,.8fr)_minmax(0,1fr)_92px] items-start gap-3 border-t border-border px-4 py-3.5"
                  >
                    <span className="text-sm font-bold">{fact.label}</span>
                    <span className={`text-sm ${missing ? "italic text-muted" : "text-text"}`}>
                      {missing ? "Nothing stored — the planner has to estimate" : value || "…"}
                    </span>
                    <span className="text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          missing ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"
                        }`}
                      >
                        {missing ? "Missing" : "Set"}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Automatic checks</p>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {current.checks.map((check) => (
                  <div
                    key={check.label}
                    className={`flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[13px] leading-normal ${
                      check.ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
                    }`}
                  >
                    {check.ok ? (
                      <CheckCircle2 className="size-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0" />
                    )}
                    <span>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[13px] text-muted">
              Publishing makes this record available to the trip engine immediately. Nothing here has been shown to a
              traveller yet.
            </p>

            <ErrorNote error={act.error} />
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {current.reason === "unverified" && (
                <button
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate({
                      item: current,
                      body: {
                        provenance: { needs_verification: false, verified_at: new Date().toISOString().slice(0, 10) },
                      },
                      done: `${current.name} marked verified.`,
                    })
                  }
                  className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 text-sm font-bold transition-colors hover:border-brand hover:bg-brand-soft disabled:opacity-50"
                >
                  <BadgeCheck className="size-4" /> Mark verified
                </button>
              )}
              {current.status === "draft" && (
                <button
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate({
                      item: current,
                      body: { status: "published" },
                      done: `${current.name} is live for travellers and the trip engine.`,
                    })
                  }
                  className="flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-navy transition-colors hover:bg-accent-strong disabled:opacity-50"
                >
                  <Send className="size-4" /> Publish
                </button>
              )}
              <Link
                href={`/locations/${current.id}`}
                className="ml-auto flex h-11 items-center rounded-full border border-border bg-surface px-5 text-sm font-bold no-underline transition-colors hover:border-brand hover:bg-brand-soft"
              >
                {current.missing_fields.length > 0 ? "Fill in the missing facts" : "Edit record"}
              </Link>
            </div>
          </Card>
        )}
      </div>

      {Object.keys(q.missing_by_field).length > 0 && (
        <Card className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">The editorial backlog</p>
          <p className="mt-1 text-sm text-muted">
            Published records short of a fact the planner relies on. Each one makes the engine estimate instead of know.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(q.missing_by_field).map(([field, count]) => (
              <span
                key={field}
                className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-[13px]"
              >
                {titleCase(field)}
                <strong className="tabular-nums">{count}</strong>
              </span>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}
