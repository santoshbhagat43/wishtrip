"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-3 last:border-0">
      <div>
        <p className="text-sm text-text">{label}</p>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      <div className="text-right text-sm tabular-nums text-text">{value}</div>
    </div>
  );
}

export default function SystemPage() {
  const queryClient = useQueryClient();
  const system = useQuery({
    queryKey: ["system"],
    queryFn: async () => unwrap(await api.GET("/admin/system")),
    refetchInterval: 30_000,
  });
  const reindex = useMutation({
    mutationFn: async () => unwrap(await api.POST("/admin/locations/reindex")),
    onSuccess: () => setTimeout(() => queryClient.invalidateQueries({ queryKey: ["system"] }), 2500),
  });

  if (system.isLoading) return <Spinner />;
  if (system.error) return <ErrorNote error={system.error} />;

  const s = system.data!;
  const indexed = s.embeddings_pending === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumb="Admin"
        title="System health"
        description="What the stack is running right now. Every figure is read live — nothing here is an estimate."
        action={
          <HeaderStats
            items={[
              { value: s.counts.published, label: "published" },
              { value: s.embeddings_pending, label: "awaiting index", tone: indexed ? "text-text" : "text-warn" },
              { value: s.counts.chat_sessions, label: "trips planned" },
            ]}
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="AI"
            description="Two calls per message: one reads the traveller's intent, one writes the reply."
            action={
              s.ai_enabled ? (
                <Badge tone="ok">
                  <CheckCircle2 className="size-3.5" /> Online
                </Badge>
              ) : (
                <Badge tone="warn">
                  <TriangleAlert className="size-3.5" /> Knowledge base only
                </Badge>
              )
            }
          />
          <Row label="Provider" value={titleCase(s.llm_provider)} />
          <Row label="Intent model" value={s.intent_model || "keyword fallback"} note="Parses a sentence into parameters" />
          <Row label="Planner model" value={s.chat_model || "knowledge-base listing"} note="Writes the reply and the plan" />
          <Row label="Embedder" value={s.embedder} note={`${s.embedding_dimensions}-dimension vectors`} />
        </Card>

        <Card>
          <CardHeader
            title="Search index"
            description="Published records are embedded so chat and search can find them by meaning."
            action={
              indexed ? (
                <Badge tone="ok">
                  <CheckCircle2 className="size-3.5" /> Up to date
                </Badge>
              ) : (
                <Button variant="secondary" onClick={() => reindex.mutate()} disabled={reindex.isPending}>
                  <RefreshCw className={`size-4 ${reindex.isPending ? "animate-spin" : ""}`} />
                  {reindex.isSuccess ? "Queued" : "Index now"}
                </Button>
              )
            }
          />
          <Row
            label="Waiting to be indexed"
            value={s.embeddings_pending}
            note={indexed ? "Every published record is searchable" : "These won't be found by meaning until indexed"}
          />
          <Row
            label="Oldest waiting"
            value={s.oldest_stale_embed ? relativeTime(s.oldest_stale_embed) : "—"}
          />
          <Row label="Published records" value={s.counts.published} />
          <Row label="Last staff change" value={s.last_audit_at ? relativeTime(s.last_audit_at) : "—"} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Volume" description="What the database holds today." />
          <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {Object.entries(s.counts).map(([key, value]) => (
              <div key={key} className="border-b border-border px-5 py-3">
                <p className="text-xs text-muted">{titleCase(key)}</p>
                <p className="font-display text-xl tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <p className="mt-4 text-sm text-muted">
        Not shown because we don&apos;t measure it yet: per-trip token cost and supplier status. Token metering lands with
        the booking rail; supplier health needs a supplier.
      </p>
    </div>
  );
}
