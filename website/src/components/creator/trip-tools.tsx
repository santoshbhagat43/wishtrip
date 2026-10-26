"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { api, errorMessage, unwrap } from "@/lib/api/client";

const STEP_LABEL: Record<string, string> = {
  queued: "Starting…",
  downloading: "Watching your reel…",
  reading_screen: "Reading the text on screen…",
  listening: "Listening to the voice-over…",
  finding_places: "Finding the places…",
  done: "Done",
};

function CreateTrip() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [importId, setImportId] = useState<string | null>(null);
  const [step, setStep] = useState("queued");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const job = unwrap(await api.POST("/creator/trips/import", { body: { url } }));
      if (job.status === "done" && job.creator_trip_id) return router.push(`/trips/${job.creator_trip_id}`);
      if (job.status === "failed") throw new Error(job.error || "That reel couldn't be read");
      setImportId(job.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!importId) return;
    timer.current = setInterval(async () => {
      const r = await api.GET("/creator/trips/imports/{import_id}", { params: { path: { import_id: importId } } });
      if (!r.data) return;
      setStep(r.data.step);
      if (r.data.status === "done" && r.data.creator_trip_id) {
        clearInterval(timer.current!);
        router.push(`/trips/${r.data.creator_trip_id}`);
      } else if (r.data.status === "failed") {
        clearInterval(timer.current!);
        setError(r.data.error || "That reel couldn't be read");
        setBusy(false);
        setImportId(null);
      }
    }, 1500);
    return () => clearInterval(timer.current!);
  }, [importId, router]);

  return (
    <form onSubmit={start} className="flex flex-col gap-3">
      {busy ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm font-medium">{STEP_LABEL[step] ?? "Working…"}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Input inputMode="url" placeholder="instagram.com/reel/… or youtube.com/shorts/…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <Button type="submit" disabled={!url.trim()}>Create trip</Button>
        </div>
      )}
      {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </form>
  );
}

export function TripTools() {
  const trips = useQuery({ queryKey: ["my-trips"], queryFn: async () => unwrap(await api.GET("/creator/trips")) });
  return (
    <div className="flex flex-col gap-5">
      <CreateTrip />
      {trips.data && trips.data.length > 0 && (
        <div className="flex flex-col gap-2">
          {trips.data.map((t) => (
            <Link key={t.id} href={`/trips/${t.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-brand">
              <span className="flex flex-1 flex-col">
                <strong>{t.title}</strong>
                <span className="text-sm text-muted">{t.destination_name} · {t.items.length} stops</span>
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${t.status === "published" ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}>
                {t.status === "published" ? "Published" : "Draft"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
