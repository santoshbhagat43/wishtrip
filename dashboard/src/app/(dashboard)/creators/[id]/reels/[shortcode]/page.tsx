"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

/** Everything we read off one reel: the evidence behind each place it gave travellers. */
export default function ReelPage() {
  const { id, shortcode } = useParams<{ id: string; shortcode: string }>();
  const reel = useQuery({
    queryKey: ["reel", shortcode],
    queryFn: async () => unwrap(await api.GET("/reels/content/{shortcode}", { params: { path: { shortcode } } })),
  });
  if (reel.isLoading) return <Spinner />;
  if (reel.error || !reel.data) return <ErrorNote error={reel.error} />;
  const r = reel.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb="Creators"
        title={r.destination_name || "Reel"}
        description={
          <span>
            <Link href={`/creators/${id}`} className="text-brand hover:underline">
              @{r.creator_handle}
            </Link>{" "}
            · {r.summary}{" "}
            <a href={r.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              Open on Instagram ↗
            </a>
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <div className="flex flex-col gap-3">
          {r.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element -- backend media
            <img src={r.thumbnail_url} alt="" className="aspect-[9/16] w-full rounded-2xl object-cover" />
          )}
          {r.caption && <p className="whitespace-pre-line text-sm text-muted">{r.caption}</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Places" description="Checked = matched to a published location in the knowledge base." />
            {r.places.length === 0 ? (
              <Empty title="No places found" />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {r.places.map((p) => (
                  <li key={p.name} className="flex items-start justify-between gap-3 px-5 py-3">
                    <span className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      {p.location_id && (
                        <Link href={`/locations/${p.location_id}`} className="ml-2 text-brand hover:underline">
                          → {p.location_name}
                        </Link>
                      )}
                      <span className="block text-muted">
                        “{p.evidence}” · {p.source}
                        {p.t != null && ` at ${clock(p.t)}`}
                      </span>
                    </span>
                    <span className="flex flex-none gap-1.5">
                      <Badge>{p.kind}</Badge>
                      <Badge tone={p.verified ? "ok" : "warn"}>{p.verified ? "Checked" : "Not in KB"}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {r.tips.length > 0 && (
            <Card>
              <CardHeader title="Creator's tips" />
              <ul className="list-disc px-10 pb-5 text-sm">
                {r.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Voice-over" description={r.transcript_language ? `Language: ${r.transcript_language}` : "Transcribed by Gemini"} />
            <div className="flex flex-col gap-3 px-5 pb-5 text-sm">
              {r.transcript ? <p className="whitespace-pre-line">{r.transcript}</p> : <p className="text-muted">No speech in this reel.</p>}
              {r.transcript_en && r.transcript_en !== r.transcript && <p className="whitespace-pre-line text-muted">English: {r.transcript_en}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Text on screen" description="Read from the frames (OCR), first time each line appeared." />
            {r.ocr_lines.length === 0 ? (
              <Empty title="No text found on screen" />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {r.ocr_lines.map((line, i) => (
                  <li key={i} className="flex gap-3 px-5 py-2">
                    <span className="w-10 flex-none tabular-nums text-muted">{clock(Number(line.t))}</span>
                    <span>{String(line.text)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
