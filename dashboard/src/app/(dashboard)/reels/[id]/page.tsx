"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { useMe } from "@/lib/hooks/use-me";
import { STAGE_LABEL, STATUS_TONE, clock, seconds } from "@/lib/reels";

export default function ReelImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: me } = useMe();
  const allowed = me?.role === "admin" || me?.role === "editor";
  const q = useQuery({
    queryKey: ["reel-import", id],
    enabled: allowed,
    refetchInterval: (query) => (query.state.data && ["done", "failed"].includes(query.state.data.status) ? false : 3000),
    queryFn: async () => unwrap(await api.GET("/reels/admin/imports/{import_id}", { params: { path: { import_id: id } } })),
  });
  if (!me || q.isLoading) return <Spinner />;
  if (!allowed) return <ErrorNote error="Only admins and editors can view reel imports." />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const r = q.data;
  const longest = Math.max(1, ...r.stages.map((s) => s.seconds), r.queue_seconds ?? 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={r.creator_handle ? `@${r.creator_handle}'s reel` : `Reel ${r.shortcode}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "neutral"}>{r.status}</Badge>
            <span>Total {seconds(r.total_seconds)}</span>
            {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-brand">Open reel</a>}
            <Link href="/reels" className="text-brand">All imports</Link>
          </span>
        }
      />
      {r.error && <ErrorNote error={r.error} />}

      <Card>
        <CardHeader title="Time per stage" description="Where the time went for this reel." />
        <div className="space-y-2 p-4">
          {r.queue_seconds != null && <Bar label="Waiting for a worker" value={r.queue_seconds} max={longest} />}
          {r.stages.map((s) => <Bar key={s.step} label={STAGE_LABEL[s.step] ?? s.step} value={s.seconds} max={longest} />)}
          {!r.stages.length && <p className="text-sm text-muted">No timings: this reel was already read before, or it ran before timings were kept.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Log" description="What happened, in order." />
        <Table>
          <thead><tr><Th>Time</Th><Th>Stage</Th><Th>What happened</Th><Th>Took</Th></tr></thead>
          <tbody>
            {r.log.map((e, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap tabular-nums text-muted">{clock(e.at)}</Td>
                <Td className="whitespace-nowrap">{e.step ? <Badge tone={e.step === "failed" ? "danger" : "info"}>{STAGE_LABEL[e.step] ?? e.step}</Badge> : null}</Td>
                <Td>{e.message || (e.step ? "Started" : "")}</Td>
                <Td className="whitespace-nowrap tabular-nums">{e.seconds != null ? seconds(e.seconds) : ""}</Td>
              </tr>
            ))}
            {!r.log.length && <tr><td colSpan={4} className="px-4 py-3 text-muted">No log for this import.</td></tr>}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Download attempts" description="Each tool we tried to fetch the video with." />
        <Table>
          <thead><tr><Th>Tool</Th><Th>Result</Th><Th>Took</Th><Th>Size</Th><Th>Cost</Th></tr></thead>
          <tbody>
            {r.downloads.map((d) => (
              <tr key={d.id}>
                <Td>{d.provider}</Td>
                <Td>{d.ok ? <Badge tone="ok">ok</Badge> : <span className="text-danger">{d.error_message || d.error_code}</span>}</Td>
                <Td className="tabular-nums">{seconds(d.duration_ms / 1000)}</Td>
                <Td className="tabular-nums">{d.bytes ? `${(d.bytes / 1e6).toFixed(1)} MB` : "—"}</Td>
                <Td>{d.credits_spent ? `${d.credits_spent} credits` : "free"}</Td>
              </tr>
            ))}
            {!r.downloads.length && <tr><td colSpan={5} className="px-4 py-3 text-muted">None (an uploaded video, or read before).</td></tr>}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Text read off the screen (${r.ocr_lines.length})`} description="OCR of the video frames." />
          <ul className="max-h-96 divide-y divide-line overflow-auto text-sm">
            {r.ocr_lines.map((l, i) => (
              <li key={i} className="flex gap-3 px-4 py-1.5">
                <span className="w-12 shrink-0 tabular-nums text-muted">{typeof l.t === "number" ? `${l.t.toFixed(1)}s` : ""}</span>
                <span>{String(l.text ?? "")}</span>
              </li>
            ))}
            {!r.ocr_lines.length && <li className="px-4 py-3 text-muted">Nothing read.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Voice-over" description={r.transcript_language ? `Language: ${r.transcript_language}` : "Speech to text"} />
          <div className="max-h-96 space-y-3 overflow-auto p-4 text-sm">
            {r.transcript ? <p className="whitespace-pre-wrap">{r.transcript}</p> : <p className="text-muted">Nothing heard.</p>}
            {r.transcript_en && r.transcript_en !== r.transcript && (
              <div><div className="text-xs font-medium uppercase text-muted">In English</div><p className="whitespace-pre-wrap">{r.transcript_en}</p></div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title={`Places found (${r.place_list.length})`} description={r.caption ? `Caption: ${r.caption.slice(0, 200)}` : undefined} />
        <Table>
          <thead><tr><Th>Place</Th><Th>Kind</Th><Th>Matched</Th><Th>Seen in</Th></tr></thead>
          <tbody>
            {r.place_list.map((p, i) => (
              <tr key={i}>
                <Td>{String(p.name ?? "")}</Td>
                <Td className="text-muted">{String(p.kind ?? "")}</Td>
                <Td>{p.verified ? <Badge tone="ok">{String(p.location_name ?? "in our places")}</Badge> : <Badge tone="warn">not in our places</Badge>}</Td>
                <Td className="text-muted">{String(p.source ?? "")}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 text-muted">{label}</span>
      <div className="h-3 flex-1 rounded bg-line/50"><div className="h-3 rounded bg-brand" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div>
      <span className="w-24 shrink-0 text-right tabular-nums">{seconds(value)}</span>
    </div>
  );
}
