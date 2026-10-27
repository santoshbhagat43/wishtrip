"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";
import { useMe } from "@/lib/hooks/use-me";
import { STAGE_LABEL, STATUS_TONE, seconds } from "@/lib/reels";

type State = "" | "in_progress" | "done" | "failed";

const PAGE = 25;

export default function ReelsPage() {
  const { data: me } = useMe();
  const allowed = me?.role === "admin" || me?.role === "editor";
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const imports = useQuery({
    queryKey: ["reel-imports", page, state, q],
    enabled: allowed,
    refetchInterval: 5000,
    // Keep showing the page while the next one loads, so the table doesn't flash to a spinner.
    placeholderData: (previous) => previous,
    queryFn: async () =>
      unwrap(
        await api.GET("/reels/admin/imports", {
          params: { query: { page, page_size: PAGE, status: state || undefined, q: q || undefined } },
        }),
      ),
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
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(text.trim());
            setPage(1);
          }}
        >
          <Select
            className="w-auto"
            value={state}
            onChange={(e) => {
              setState(e.target.value as State);
              setPage(1);
            }}
            aria-label="Status"
          >
            <option value="">All imports</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </Select>
          <Input
            className="min-w-[220px] flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search the link, creator, destination, who asked or the error…"
            aria-label="Search"
          />
          <Button type="submit" variant="secondary">Search</Button>
          {(q || state) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setText("");
                setQ("");
                setState("");
                setPage(1);
              }}
            >
              Clear
            </Button>
          )}
        </form>
        {imports.isLoading ? <Spinner /> : imports.error ? <div className="p-4"><ErrorNote error={imports.error} /></div> : imports.data!.items.length === 0 ? (
          <p className="m-0 p-8 text-center text-sm text-muted">
            {q || state ? "No imports match that search." : "No reels have been imported yet."}
          </p>
        ) : (
          <>
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
          <Pagination page={page} pageSize={PAGE} total={imports.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
