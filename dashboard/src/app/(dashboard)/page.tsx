"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BrainCircuit, CheckCircle2, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";
import { LOCATION_TYPES, relativeTime, titleCase } from "@/lib/format";

type Health = { status: string; ai_enabled: boolean; chat_model: string | null; embedder: string };

function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: string }) {
  const body = (
    <div className="rounded-2xl border border-border bg-surface px-5 py-4 shadow-card transition-colors hover:border-brand">
      <p className="text-sm text-muted">{label}</p>
      <p className={`font-display mt-1 text-[30px] leading-none tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function OverviewPage() {
  const queryClient = useQueryClient();
  const stats = useQuery({ queryKey: ["stats"], queryFn: async () => unwrap(await api.GET("/admin/stats")) });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await fetch("/api/backend/health")).json() as Promise<Health>,
  });
  const unverified = useQuery({
    queryKey: ["locations", "needs-verification-count"],
    queryFn: async () =>
      unwrap(await api.GET("/admin/locations", { params: { query: { needs_verification: true, page_size: 1 } } })),
  });
  const activity = useQuery({
    queryKey: ["audit", "recent"],
    queryFn: async () => unwrap(await api.GET("/admin/audit-log", { params: { query: { page_size: 8 } } })),
  });
  const reindex = useMutation({
    mutationFn: async () => unwrap(await api.POST("/admin/locations/reindex")),
    onSuccess: () => setTimeout(() => queryClient.invalidateQueries({ queryKey: ["stats"] }), 2500),
  });

  if (stats.isLoading) return <Spinner />;
  if (stats.error) return <ErrorNote error={stats.error} />;
  const s = stats.data!;
  const places = LOCATION_TYPES.filter((t) => t !== "country" && t !== "city").reduce(
    (sum, t) => sum + (s.by_type[t] ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Overview"
        description="What WishTrip knows today, and what needs attention before the AI relies on it."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Places" value={places} href="/locations" />
        <Stat label="Cities" value={s.by_type.city ?? 0} href="/locations?type=city" />
        <Stat label="Published" value={s.by_status.published ?? 0} href="/locations?status=published" tone="text-ok" />
        <Stat label="Drafts" value={s.by_status.draft ?? 0} href="/locations?status=draft" tone="text-warn" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Needs attention" description="Gaps that make recommendations weaker or less honest." />
          <ul className="divide-y divide-border">
            <li className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium">Incomplete records</p>
                <p className="text-sm text-muted">Missing duration, best time, coordinates or other key facts.</p>
              </div>
              <Link href="/locations?status=published" className="text-sm font-medium text-brand">
                {s.incomplete} to review
              </Link>
            </li>
            <li className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium">Needs verification</p>
                <p className="text-sm text-muted">Imported hotels and records whose facts haven&apos;t been checked yet.</p>
              </div>
              <Link href="/locations?needs_verification=true" className="text-sm font-medium text-brand">
                {unverified.data?.total ?? "…"} to verify
              </Link>
            </li>
            <li className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium">Search index</p>
                <p className="text-sm text-muted">
                  {s.embeddings_pending === 0
                    ? "Every published location is indexed for search and chat."
                    : `${s.embeddings_pending} published locations aren't indexed for search and chat yet.`}
                </p>
              </div>
              {s.embeddings_pending === 0 ? (
                <Badge tone="ok"><CheckCircle2 className="size-3.5" /> Up to date</Badge>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => reindex.mutate()} disabled={reindex.isPending}>
                  <RefreshCw className={`size-3.5 ${reindex.isPending ? "animate-spin" : ""}`} />
                  {reindex.isSuccess ? "Queued" : "Index now"}
                </Button>
              )}
            </li>
          </ul>
        </Card>

        <Card>
          <CardHeader title="AI" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <div className="flex items-center gap-2">
              <BrainCircuit className="size-4 text-brand" />
              {health.data?.ai_enabled ? (
                <span>
                  Chat model <span className="font-medium">{health.data.chat_model}</span>
                </span>
              ) : (
                <span className="text-warn">AI offline — knowledge-base-only answers</span>
              )}
            </div>
            <p className="text-muted">
              Embeddings: <span className="font-medium text-text">{health.data?.embedder ?? "…"}</span>
            </p>
            {health.data && !health.data.ai_enabled && (
              <p className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Add OPENROUTER_API_KEY to .env and restart the backend to enable Grok and Gemini embeddings.
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="By type" />
          <ul className="px-5 py-3">
            {LOCATION_TYPES.map((t) => (
              <li key={t} className="flex justify-between py-1.5 text-sm">
                <Link href={`/locations?type=${t}`} className="text-muted hover:text-text">{titleCase(t)}</Link>
                <span className="tabular-nums">{s.by_type[t] ?? 0}</span>
              </li>
            ))}
            <li className="mt-2 flex justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted">Relationships · Tags</span>
              <span className="tabular-nums">{s.relations} · {s.tags}</span>
            </li>
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" action={<Link href="/audit-log" className="text-sm text-brand">View all</Link>} />
          <ul className="divide-y divide-border">
            {activity.data?.items.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{entry.user_email}</span>{" "}
                  <span className="text-muted">{entry.action}d a {entry.entity_type}</span>{" "}
                  {"name" in entry.changes && <span>“{String(entry.changes.name)}”</span>}
                </span>
                <span className="shrink-0 text-muted">{relativeTime(entry.created_at)}</span>
              </li>
            ))}
            {activity.data?.items.length === 0 && <li className="px-5 py-6 text-sm text-muted">No changes yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
