"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";
import { useMe } from "@/lib/hooks/use-me";
import { STAGE_LABEL, STATUS_TONE, seconds } from "@/lib/reels";

export default function ReelsPage() {
  const { data: me } = useMe();
  const allowed = me?.role === "admin" || me?.role === "editor";
  const imports = useQuery({
    queryKey: ["reel-imports"],
    enabled: allowed,
    refetchInterval: 5000,
    queryFn: async () => unwrap(await api.GET("/reels/admin/imports", { params: { query: { limit: 200 } } })),
  });
  if (!me) return <Spinner />;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Reel imports" description="Only admins and editors can view reel imports." />
        <ErrorNote error="Only admins and editors can view reel imports." />
      </div>
    );
  }
  const totals = imports.data?.totals;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Reel imports"
        description="Every reel turned into an itinerary: where it stands and how long each stage took. Refreshes by itself."
      />
      {totals && (
        <HeaderStats
          items={[
            { label: "Imports", value: totals.total },
            { label: "Done", value: totals.done },
            { label: "In progress", value: totals.running },
            { label: "Failed", value: totals.failed },
            { label: "Average time (done)", value: seconds(totals.average_seconds) },
          ]}
        />
      )}
      <Card>
        {imports.isLoading ? <Spinner /> : imports.error ? <div className="p-4"><ErrorNote error={imports.error} /></div> : (
          <Table>
            <thead>
              <tr>
                <Th>Reel</Th><Th>Status</Th><Th>Download</Th><Th>Screen + voice</Th><Th>Places + trip</Th><Th>Total</Th><Th>Started</Th>
              </tr>
            </thead>
            <tbody>
              {imports.data!.items.map((row) => {
                const stage = (name: string) => row.stages.find((s) => s.step === name)?.seconds;
                return (
                  <tr key={row.id}>
                    <Td>
                      <Link href={`/reels/${row.id}`} className="font-medium text-brand">
                        {row.creator_handle ? `@${row.creator_handle}` : row.shortcode}
                      </Link>
                      <div className="text-xs text-muted">
                        {row.destination_name || "—"} · {row.places} places · {row.kind === "creator_trip" ? "creator" : "traveller"} · {row.requested_by}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}>{row.status}</Badge>
                      {row.status === "running" || row.status === "queued" ? (
                        <div className="text-xs text-muted">{STAGE_LABEL[row.step] ?? titleCase(row.step)}</div>
                      ) : null}
                      {row.error && <div className="max-w-56 truncate text-xs text-danger" title={row.error}>{row.error}</div>}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{seconds(stage("downloading"))}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{seconds(stage("reading_screen"))}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{seconds(stage("finding_places"))}</Td>
                    <Td className="whitespace-nowrap font-medium tabular-nums">{seconds(row.total_seconds)}</Td>
                    <Td className="whitespace-nowrap text-muted">{relativeTime(row.created_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
