"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { titleCase } from "@/lib/format";
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

      <SourceCard source={r.source} caption={r.caption} />

      {r.read_from === "caption" && r.status === "done" && <CaptionOnly url={r.url} />}

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
        {r.downloads.some((d) => d.meta) && (
          <div className="space-y-2 border-t border-line p-4">
            <div className="text-sm font-medium">What each tool said about the post (meta)</div>
            {r.downloads.filter((d) => d.meta).map((d) => (
              <details key={d.id} open={r.downloads.filter((x) => x.meta).length === 1}>
                <summary className="cursor-pointer text-sm">
                  {d.provider} · {d.platform} · {d.ok ? "ok" : "failed"}
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded bg-surface-2 p-3 text-xs leading-relaxed">
                  {JSON.stringify(d.meta, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Text read off the screen (${r.ocr_lines.length})`} description="OCR of the video frames." />
          <ul className="max-h-96 divide-y divide-line overflow-auto text-sm">
            {r.ocr_lines.map((l, i) => (
              <li key={i} className="flex gap-3 px-4 py-1.5">
                <span className="w-12 shrink-0 tabular-nums text-muted">{typeof l.t === "number" ? at(l.t) : ""}</span>
                <span>{String(l.text ?? "")}</span>
              </li>
            ))}
            {!r.ocr_lines.length && <li className="px-4 py-3 text-muted">Nothing read.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Voice-over" description={r.transcript_language ? `Language: ${r.transcript_language}` : "Speech to text"} />
          <div className="max-h-96 space-y-3 overflow-auto p-4 text-sm">
            {r.transcript_segments?.length ? (
              <p className="leading-relaxed">
                {r.transcript_segments.map((seg, i) => (
                  <span key={i}>
                    <span className="font-medium tabular-nums text-brand">({at(Number(seg.t))})</span> {String(seg.text)}{" "}
                  </span>
                ))}
              </p>
            ) : r.transcript ? (
              <p className="whitespace-pre-wrap">{r.transcript}</p>
            ) : (
              <p className="text-muted">Nothing heard.</p>
            )}
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

/** This reel was read from its caption alone (it was a whole itinerary): no video, screen text or
 *  voice-over. Staff can still have the video read. */
function CaptionOnly({ url }: { url: string }) {
  const router = useRouter();
  const again = useMutation({
    mutationFn: async () => unwrap(await api.POST("/reels/imports", { body: { url, refresh: true, full: true } })),
    onSuccess: (job) => router.push(`/reels/${job.id}`),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="font-medium">Read from the caption only</div>
          <div className="text-sm text-muted">
            The caption is a whole itinerary, so the video was not fetched and its screen text and voice-over were not read. That saved time and AI cost. Places have no “seen at” time.
          </div>
        </div>
        <Button type="button" variant="secondary" disabled={again.isPending || !url} onClick={() => again.mutate()}>
          {again.isPending ? "Starting…" : "Read the video too"}
        </Button>
      </div>
      {again.error && <div className="px-4 pb-4"><ErrorNote error={again.error} /></div>}
    </Card>
  );
}

type Music = { title?: string; author?: string; original?: boolean };

const SHOWN = new Set([
  "platform", "source", "source_url", "video_id", "title", "author", "username", "author_url", "author_verified",
  "duration", "views", "likes", "comments", "shares", "saves", "location", "region", "published_at", "music",
]);

const count = (n: unknown) => (typeof n === "number" ? n.toLocaleString() : null);

/** What the platform told us about the post (Instagram / YouTube, through SaveAPI or yt-dlp):
 *  who made it, how it did, where and when. The caption is read for places along with the rest. */
function SourceCard({ source, caption }: { source: Record<string, unknown>; caption: string }) {
  if (!Object.keys(source).length) return null;
  const text = (key: string) => (typeof source[key] === "string" && source[key] ? (source[key] as string) : null);
  const platform = text("platform") === "youtube" ? "YouTube" : "Instagram";
  const author = text("author");
  const authorUrl = text("author_url");
  const music = (source.music ?? null) as Music | null;
  const published = text("published_at");
  const place = [text("location"), text("region")].filter(Boolean).join(", ");
  const stats: [string, string | null][] = [
    ["Views", count(source.views)],
    ["Likes", count(source.likes)],
    ["Comments", count(source.comments)],
    ["Shares", count(source.shares)],
    ["Saves", count(source.saves)],
    ["Length", typeof source.duration === "number" ? seconds(source.duration) : null],
  ];
  const facts: [string, React.ReactNode][] = [
    ["Posted", published ? new Date(published).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null],
    ["Place tag", place || null],
    ["Music", music?.title ? `${music.title}${music.author ? ` — ${music.author}` : ""}${music.original ? " (original audio)" : ""}` : null],
    ["Post id", text("video_id")],
  ].filter(([, v]) => v) as [string, React.ReactNode][];
  const more = Object.entries(source).filter(([k, v]) => !SHOWN.has(k) && v != null && typeof v !== "object");
  return (
    <Card>
      <CardHeader
        title={`From ${platform}`}
        description={`What ${platform} told us about this post, via ${text("source") === "yt-dlp" ? "yt-dlp" : "SaveAPI"}. We read the caption for places along with the screen and the voice-over.`}
        action={text("source_url") && <a href={text("source_url")!} target="_blank" rel="noreferrer" className="text-sm text-brand">Open post ↗</a>}
      />
      <div className="space-y-4 px-4 pb-4">
        {(author || text("username")) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{author ?? `@${text("username")}`}</span>
            {source.author_verified === true && <Badge tone="info">verified</Badge>}
            {authorUrl && <a href={authorUrl} target="_blank" rel="noreferrer" className="text-sm text-brand">{text("username") ? `@${text("username")}` : "Profile"} ↗</a>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label}>
              <div className="text-xs font-medium uppercase text-muted">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{value ?? "—"}</div>
            </div>
          ))}
        </div>
        {facts.length > 0 && (
          <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted">{label}</dt>
                <dd className="m-0 min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {more.length > 0 && (
          <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {more.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted">{titleCase(k)}</dt>
                <dd className="m-0 min-w-0 break-words">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {caption && (
          <details open={caption.length < 400}>
            <summary className="cursor-pointer text-sm font-medium">Caption the creator wrote</summary>
            <p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{caption}</p>
          </details>
        )}
      </div>
    </Card>
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
      {latest?.build_status === "ready" && <Rates code={latest.code} />}
      {latest && latest.build_status !== "building" && <Days items={latest.items as Stop[]} days={latest.days} />}
    </Card>
  );
}

type Rates = components["schemas"]["ItineraryRates"];
type StayRow = Rates["stays"]["stays"][number];

const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const short = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

const FLIGHT_STATUS: Record<string, string> = {
  priced: "Priced",
  no_dates: "No travel date",
  no_origin: "No home city",
  no_airport: "No airport found for this trip",
  same_city: "Home city is the destination",
  unavailable: "TripJack has no fare for these dates",
  error: "TripJack did not answer",
};

/** Every stay mapped to a hotel and the return flight, priced live by TripJack's UAT API for the
 *  dates chosen. Stays that name no hotel we hold show the closest hotels with a room instead. */
function Rates({ code }: { code: string }) {
  const [start, setStart] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const rates = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/reels/admin/itineraries/{code}/rates", { params: { path: { code } }, body: { start_date: start } })),
  });
  const r = rates.data;
  return (
    <div className="mx-4 mb-4 rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="mr-auto">
          <div className="font-medium">Hotel and flight rates</div>
          <div className="text-sm text-muted">Maps every stay to a hotel and prices it, and the return flight, live from the TripJack UAT API.</div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Leaving
          <Input type="date" className="w-auto" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Leaving on" />
        </label>
        <Button type="button" variant="accent" disabled={rates.isPending || !start} onClick={() => rates.mutate()}>
          {rates.isPending ? "Asking TripJack…" : r ? "Get rates again" : "Get TripJack rates"}
        </Button>
      </div>
      {rates.error && <div className="px-3 pb-3"><ErrorNote error={rates.error} /></div>}
      {r && (
        <div className="space-y-4 border-t border-line p-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="text-2xl font-semibold tabular-nums">{inr(r.total)}</span>
            <span>{short(r.start_date)} – {short(r.end_date)} · from {r.origin || "—"} · {r.stays.rooms} {r.stays.rooms === 1 ? "room" : "rooms"}</span>
            <span className="text-muted">
              {String(r.supplier.environment ?? "")} · {(r.supplier.calls as unknown[] | undefined)?.length ?? 0} TripJack calls · {r.seconds} s · trace {String(r.supplier.trace_id ?? "")}
            </span>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Stays · {inr(r.stays.total)} for the stays with a hotel we hold{r.stays.all_priced ? "" : " (others: nearest hotel's rate, counted in the total)"}</div>
            <Table>
              <thead><tr><Th>Stay</Th><Th>Hotel</Th><Th>Nights</Th><Th>Room</Th><Th>Rate</Th></tr></thead>
              <tbody>
                {r.stays.stays.map((s) => <StayRates key={s.item_id} stay={s} />)}
              </tbody>
            </Table>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">
              Flight · {r.flight.status === "priced" ? `${inr(r.flight.total)} for ${r.flight.adults} ${r.flight.adults === 1 ? "adult" : "adults"}${r.flight.children ? ` and ${r.flight.children} children` : ""}` : FLIGHT_STATUS[r.flight.status] ?? r.flight.status}
            </div>
            {r.flight.legs.length > 0 && (
              <Table>
                <thead><tr><Th>Route</Th><Th>Date</Th><Th>Flight</Th><Th>Departs</Th><Th>Stops</Th><Th>Fare</Th></tr></thead>
                <tbody>
                  {r.flight.legs.map((l, i) => (
                    <tr key={i}>
                      <Td className="font-medium">{l.from_code} → {l.to_code}</Td>
                      <Td>{short(l.date)}</Td>
                      <Td>{[l.airline, l.flight_number].filter(Boolean).join(" ") || "—"}</Td>
                      <Td className="tabular-nums">{l.departs ? new Date(l.departs).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—"}</Td>
                      <Td>{l.stops ? l.stops : "Non-stop"}</Td>
                      <Td className="tabular-nums">{inr(l.price)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>

          <details>
            <summary className="cursor-pointer text-sm">TripJack calls ({(r.supplier.calls as unknown[] | undefined)?.length ?? 0})</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {((r.supplier.calls ?? []) as { endpoint: string; status: number | null; ms: number; error: string }[]).map((c, i) => (
                <li key={i} className="tabular-nums">
                  <span className={c.status === 200 ? "" : "text-danger"}>{c.status ?? "—"}</span> · {c.ms} ms · {c.endpoint}{c.error ? ` · ${c.error}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

const STAY_STATUS: Record<string, string> = {
  unavailable: "No room for these dates",
  no_dates: "No night here",
  error: "TripJack did not answer",
};

function StayRates({ stay }: { stay: StayRow }) {
  const nearest = stay.alternatives?.[0];
  const nights = stay.check_in && stay.check_out ? `${short(stay.check_in)} → ${short(stay.check_out)} · ${stay.nights}` : null;
  if (stay.status === "priced") {
    return (
      <tr>
        <Td>{stay.name}</Td>
        <Td>{stay.hotel?.name}</Td>
        <Td className="whitespace-nowrap">{nights}</Td>
        <Td className="text-muted">{[stay.room, stay.meal_basis].filter(Boolean).join(" · ")}</Td>
        <Td className="font-medium tabular-nums">{inr(stay.total)}</Td>
      </tr>
    );
  }
  if (nearest) {
    return (
      <tr>
        <Td>{stay.name}</Td>
        <Td>
          {nearest.hotel.name} <Badge tone="warn">nearest</Badge>
          <div className="text-xs text-muted">{nearest.reason}{stay.alternatives.length > 1 ? ` · ${stay.alternatives.length - 1} more: ${stay.alternatives.slice(1).map((a) => `${a.hotel.name} ${inr(a.total)}`).join(", ")}` : ""}</div>
        </Td>
        <Td className="whitespace-nowrap">{nights}</Td>
        <Td className="text-muted">{[nearest.room, nearest.meal_basis].filter(Boolean).join(" · ")}</Td>
        <Td className="font-medium tabular-nums">{inr(nearest.total)}</Td>
      </tr>
    );
  }
  return (
    <tr>
      <Td>{stay.name}</Td>
      <Td className="text-muted">{stay.hotel?.name ?? "No hotel found"}</Td>
      <Td className="whitespace-nowrap text-muted">{nights ?? "Same day as the next stay"}</Td>
      <Td />
      <Td className="text-muted">{STAY_STATUS[stay.status] ?? (nights ? "No hotel with a room nearby" : "—")}</Td>
    </tr>
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

/** Seconds into the video as m:ss, the way a player shows it. */
function at(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
