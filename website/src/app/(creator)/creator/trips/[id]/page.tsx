"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { api, unwrap, type Schemas } from "@/lib/api/client";

type Trip = Schemas["CreatorTripRead"];
type Item = Schemas["TripItem"];
const KINDS = ["sight", "food", "stay", "experience", "area", "note"];
const blank = (): Item => ({ id: `new-${crypto.randomUUID()}`, kind: "sight", name: "", note: "", day: null, location_id: null, verified: false });

export default function TripEditorPage() {
  const { id } = useParams<{ id: string }>();
  const trip = useQuery({
    queryKey: ["trip", id],
    queryFn: async () => unwrap(await api.GET("/creator/trips/{trip_id}", { params: { path: { trip_id: id } } })),
  });

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fill the form from the loaded trip once (adjust-state-while-rendering, not an effect).
  if (trip.data && loadedId !== trip.data.id) {
    setTitle(trip.data.title);
    setSummary(trip.data.summary);
    setItems(trip.data.items);
    setLoadedId(trip.data.id);
  }
  const loaded = loadedId !== null;

  const save = useMutation({
    mutationFn: async (publish: boolean) =>
      unwrap(await api.PATCH("/creator/trips/{trip_id}", {
        params: { path: { trip_id: id } },
        body: { title, summary, items: items.filter((i) => i.name.trim()), ...(publish ? { publish: true } : {}) },
      })),
    onSuccess: (data: Trip) => { trip.refetch(); setItems(data.items); },
  });

  if (trip.isLoading || !loaded) return <div className="mx-auto max-w-2xl px-4 py-16 text-muted">Loading…</div>;

  const published = trip.data?.status === "published";
  const shareUrl = trip.data?.share_code ? `${typeof window !== "undefined" ? window.location.origin : ""}/t/${trip.data.share_code}` : "";
  const move = (idx: number, by: number) => {
    const next = [...items];
    const j = idx + by;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setItems(next);
  };
  const setItem = (idx: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/creator" className="text-sm text-muted hover:text-text">← Your trips</Link>

      {published && shareUrl && (
        <div className="mt-4 flex flex-col gap-2 rounded-[22px] border border-ok/40 bg-ok-soft p-5">
          <strong className="text-ok">Published — share this link in your video</strong>
          <span className="flex gap-2">
            <Input readOnly value={shareUrl} className="min-w-0 flex-1" />
            <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); }}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </span>
          <span className="text-sm text-ok">Every booking through this link earns your commission.</span>
        </div>
      )}

      <h1 className="mt-5 text-[28px] leading-tight">Edit your trip</h1>
      <div className="mt-5 flex flex-col gap-4">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Summary"><Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Stops</span>
          {items.map((it, idx) => (
            <div key={it.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3">
              <div className="flex gap-2">
                <Input className="flex-1" placeholder="Name (e.g. Fort Aguada)" value={it.name} onChange={(e) => setItem(idx, { name: e.target.value })} />
                <Select value={it.kind} onChange={(e) => setItem(idx, { kind: e.target.value })} className="w-32">
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </Select>
              </div>
              <Input placeholder="Note (optional)" value={it.note} onChange={(e) => setItem(idx, { note: e.target.value })} />
              <div className="flex items-center gap-3 text-sm text-muted">
                {it.verified && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">Checked</span>}
                <button onClick={() => move(idx, -1)} className="hover:text-text" aria-label="Move up">↑</button>
                <button onClick={() => move(idx, 1)} className="hover:text-text" aria-label="Move down">↓</button>
                <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="ml-auto text-danger hover:underline">Remove</button>
              </div>
            </div>
          ))}
          <button onClick={() => setItems([...items, blank()])} className="self-start rounded-full border border-dashed border-border px-4 py-2 text-sm font-medium text-muted hover:text-text">
            + Add a stop
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={() => save.mutate(false)} disabled={save.isPending}>
            {save.isPending && !save.variables ? "Saving…" : "Save draft"}
          </Button>
          <Button onClick={() => save.mutate(true)} disabled={save.isPending || !items.some((i) => i.name.trim())}>
            {published ? "Update & keep live" : "Publish & get link"}
          </Button>
        </div>
      </div>
    </div>
  );
}
