"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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
      <PasteLink />
      <TestUpload />
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
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block max-w-72 truncate text-xs text-brand hover:underline"
                        title={row.url}
                      >
                        {row.url} ↗
                      </a>
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


/** Paste an Instagram reel or YouTube link: we fetch the video and what the platform says about it
 *  (SaveAPI), then read it for places like any import, and open its page to watch it happen. */
function PasteLink() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [again, setAgain] = useState(false);
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const job = unwrap(await api.POST("/reels/imports", { body: { url: url.trim(), refresh: again, full: whole } }));
      router.push(`/reels/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That link didn't work.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <form className="space-y-3 p-4" onSubmit={start}>
        <div>
          <div className="font-medium">Read a link</div>
          <div className="text-sm text-muted">
            Paste an Instagram reel or YouTube video link. We fetch its details (author, likes, caption, location, music). When the caption is a whole itinerary we list the places from it and skip the video; otherwise we also read the screen and voice-over.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[260px] flex-1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.instagram.com/reels/… or https://www.youtube.com/watch?v=…"
            aria-label="Reel or video link"
          />
          <Button type="submit" variant="accent" disabled={busy || !url.trim()}>
            {busy ? "Starting…" : "Read this link"}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
          Fetch it again even if it was read before (uses SaveAPI credits)
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          Read the video too, even when the caption is already a whole itinerary
        </label>
        {error && <ErrorNote error={error} />}
      </form>
    </Card>
  );
}

/** Upload a video from this computer and watch it read: the same pipeline as a traveller's
 *  upload (screen text, voice-over, places), then build its itinerary on the import's page. */
function TestUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reel-upload", {
        method: "POST",
        headers: { "content-type": file.type || "video/mp4", "x-reel-filename": file.name },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The upload failed.");
      router.push(`/reels/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed.");
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="font-medium">Test a video</div>
          <div className="text-sm text-muted">Upload an MP4 or MOV from your computer. It is read like any reel; you&apos;ll see the screen text, voice-over and places as they come in.</div>
        </div>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/*"
          className="hidden"
          aria-label="Video to test"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="accent" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Upload a video"}
        </Button>
      </div>
      {error && <div className="px-4 pb-4"><ErrorNote error={error} /></div>}
    </Card>
  );
}
