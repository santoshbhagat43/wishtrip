"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { useMe } from "@/lib/hooks/use-me";
import { STAGE_LABEL, STATUS_TONE, clock, seconds } from "@/lib/reels";

export default function ReelImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: me } = useMe();
  const allowed = me?.role === "admin" || me?.role === "editor";
  const q = useQuery({
    queryKey: ["reel-import", id],
    enabled: allowed,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      const reading = !["done", "failed"].includes(d.status);
      const building = d.itineraries?.some((t) => t.build_status === "building");
      return reading || building ? 3000 : false;
    },
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

      <TripCard extracted={r.extracted} />

      {r.status === "done" && <ItineraryCard importId={id} itineraries={r.itineraries ?? []} />}

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
        <CardHeader
          title={`Places found (${r.place_list.length})`}
          description={r.caption ? `Caption: ${r.caption.slice(0, 200)}` : undefined}
          action={r.status === "done" && <AddToOurPlaces importId={id} missing={r.place_list.filter((p) => !p.verified).length} />}
        />
        <Table>
          <thead><tr><Th>Place</Th><Th>Kind</Th><Th>Matched</Th><Th>At</Th><Th>Seen in</Th><Th>What it said</Th></tr></thead>
          <tbody>
            {r.place_list.map((p, i) => (
              <tr key={i}>
                <Td>{String(p.name ?? "")}</Td>
                <Td className="text-muted">{String(p.kind ?? "")}</Td>
                <Td>{p.verified ? <Badge tone="ok">{String(p.location_name ?? "in our places")}</Badge> : <Badge tone="warn">not in our places</Badge>}</Td>
                <Td className="whitespace-nowrap tabular-nums">{typeof p.t === "number" ? `${Math.floor(p.t / 60)}:${String(Math.floor(p.t % 60)).padStart(2, "0")}` : <span className="text-muted">—</span>}</Td>
                <Td className="text-muted">{String(p.source ?? "")}</Td>
                <Td className="max-w-80 text-xs text-muted">{String(p.evidence ?? "")}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

type Leg = { days?: string; area?: string; stay?: string };

/** What the reel says the trip is: where, how many days, and how the creator splits them. */
function TripCard({ extracted }: { extracted: Record<string, unknown> }) {
  const destination = String(extracted.destination ?? "");
  const daysSaid = String(extracted.days_said ?? "");
  const days = typeof extracted.days_hint === "number" ? extracted.days_hint : null;
  const legs = (Array.isArray(extracted.legs) ? extracted.legs : []) as Leg[];
  const summary = String(extracted.summary ?? "");
  if (!destination && !days && !summary) return null;
  return (
    <Card>
      <CardHeader title="The trip" description={summary || undefined} />
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-3">
        <div>
          <div className="text-xs font-medium uppercase text-muted">Destination</div>
          <div className="text-lg font-semibold">{destination || "—"}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-muted">Trip length</div>
          <div className="text-lg font-semibold">
            {days ? `${days} ${days === 1 ? "day" : "days"}` : "Not said"}
          </div>
          {daysSaid && <div className="text-xs text-muted">The creator said “{daysSaid}”</div>}
        </div>
        <div>
          <div className="text-xs font-medium uppercase text-muted">Split</div>
          {legs.length ? (
            <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {legs.map((leg, i) => (
                <li key={i}>
                  {leg.days && <strong className="tabular-nums">Days {leg.days}: </strong>}
                  {leg.area}
                  {leg.stay && <span className="text-muted"> · stay in {leg.stay}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-muted">Not split by the creator</div>
          )}
        </div>
      </div>
    </Card>
  );
}

type Added = { added: { name: string; type: string; town: string }[]; skipped: { name: string; why: string }[] };

/** Publish the places this reel names that we don't have yet (name, type and town), so they
 *  count as ours; staff fill in the rest on the Locations page. */
function AddToOurPlaces({ importId, missing }: { importId: string; missing: number }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/backend/reels/admin/imports/${importId}/places`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Adding the places failed.");
      return data as Added;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reel-import", importId] }),
  });
  const done = add.data;
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      {missing > 0 && (
        <Button type="button" variant="accent" size="sm" disabled={add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Adding…" : `Add ${missing} to our places`}
        </Button>
      )}
      {done && (
        <span className="max-w-80 text-xs text-muted">
          Added {done.added.length} (published, marked to verify)
          {done.skipped.length ? `; left out ${done.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}` : ""}
        </span>
      )}
      {add.error && <span className="text-xs text-danger">{add.error.message}</span>}
    </div>
  );
}

type Itinerary = components["schemas"]["ImportItinerary"];
type Stop = { day?: number; slot?: string; kind?: string; name?: string; note?: string; optional?: boolean };

const SLOT_ORDER: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, night: 3 };

/** The itineraries built from this reel, day by day; staff can build one for a sample couple. */
function ItineraryCard({ importId, itineraries }: { importId: string; itineraries: Itinerary[] }) {
  const qc = useQueryClient();
  const build = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/reels/admin/imports/{import_id}/itinerary", { params: { path: { import_id: importId } }, body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reel-import", importId] }),
  });
  const latest = itineraries[0];
  return (
    <Card>
      <CardHeader
        title="Itinerary"
        description={
          latest
            ? `${latest.days} days for ${party(latest)}${latest.origin_city ? ` from ${latest.origin_city}` : ""} · built ${new Date(latest.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}${latest.build_status === "ready" ? (latest.ai_built ? " with AI" : " by rule (no AI)") : ""}`
            : "No itinerary has been built from this reel yet."
        }
      />
      <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
        <Button type="button" variant={latest ? "ghost" : "accent"} disabled={build.isPending} onClick={() => build.mutate()}>
          {build.isPending ? "Starting…" : latest ? "Build again" : "Build itinerary for a couple"}
        </Button>
        {latest?.build_status === "building" && <span className="text-sm text-muted">Building… this takes up to a minute.</span>}
        {latest?.build_status === "failed" && <span className="text-sm text-danger">Build failed: {latest.build_error || "unknown error"}</span>}
        {build.error && <ErrorNote error={build.error} />}
      </div>
      {latest && latest.build_status !== "building" && <Days items={latest.items as Stop[]} days={latest.days} />}
    </Card>
  );
}

function party(t: Itinerary) {
  if (t.group === "couple") return "a couple";
  const people = [t.adults && `${t.adults} adults`, t.kids && `${t.kids} kids`, t.seniors && `${t.seniors} seniors`].filter(Boolean);
  return people.join(", ") || "the party";
}

function Days({ items, days }: { items: Stop[]; days: number }) {
  const byDay = Array.from({ length: days }, (_, i) =>
    items
      .filter((it) => it.day === i + 1)
      .sort((a, b) => (SLOT_ORDER[a.slot ?? ""] ?? 9) - (SLOT_ORDER[b.slot ?? ""] ?? 9)),
  );
  return (
    <ol className="m-0 grid list-none gap-3 px-4 pb-4 lg:grid-cols-2">
      {byDay.map((stops, i) => (
        <li key={i} className="rounded-xl border border-border p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <strong>Day {i + 1}</strong>
            <span className="text-xs text-muted">{stops.filter((s) => s.kind === "sight" || s.kind === "experience").length} things to do</span>
          </div>
          {stops.length ? (
            <ul className="m-0 list-none space-y-1.5 p-0 text-sm">
              {stops.map((s, j) => (
                <li key={j} className="flex gap-2">
                  <span className="w-20 shrink-0 text-xs capitalize text-muted">{s.slot || ""}</span>
                  <span className="min-w-0">
                    <Badge tone={KIND_TONE[s.kind ?? ""] ?? "neutral"}>{s.kind}</Badge>{" "}
                    <span className={s.optional ? "text-muted" : ""}>{s.name}</span>
                    {s.optional && <span className="text-xs text-muted"> (optional)</span>}
                    {s.note && <span className="block text-xs text-muted">{s.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-muted">Nothing planned.</p>
          )}
        </li>
      ))}
    </ol>
  );
}

const KIND_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = { stay: "ok", travel: "neutral", food: "warn", sight: "ok", experience: "ok" };

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 text-muted">{label}</span>
      <div className="h-3 flex-1 rounded bg-line/50"><div className="h-3 rounded bg-brand" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div>
      <span className="w-24 shrink-0 text-right tabular-nums">{seconds(value)}</span>
    </div>
  );
}
