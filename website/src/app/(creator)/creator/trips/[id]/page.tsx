"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, ImagePlus, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { CoverPicker } from "@/components/creator/cover-picker";
import { Spinner } from "@/components/ui/card";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api/client";
import { withoutScheme } from "@/lib/creator";
import { copyText } from "@/lib/clipboard";

type Trip = Schemas["CreatorTripRead"];
type Item = Schemas["TripItem"];

const KINDS: { value: string; label: string; chip: string }[] = [
  { value: "sight", label: "See", chip: "bg-brand-soft text-brand" },
  { value: "food", label: "Eat", chip: "bg-danger-soft text-danger" },
  { value: "stay", label: "Stay", chip: "bg-ai-soft text-ai" },
  { value: "experience", label: "Experience", chip: "bg-warn-soft text-warn" },
  { value: "area", label: "Explore", chip: "bg-info-soft text-info" },
  { value: "note", label: "Note", chip: "bg-surface-2 text-muted" },
];
const kindOf = (value: string) => KINDS.find((k) => k.value === value) ?? KINDS[0];

const blank = (day: number): Item => ({
  id: `new-${crypto.randomUUID()}`,
  kind: "sight",
  name: "",
  note: "",
  day,
  location_id: null,
  verified: false,
  origin: "creator",
});

const reelTime = (t: number | null | undefined) =>
  typeof t === "number" ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : null;

const FIELD =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[14.5px] outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/20";

/** Where a stop came from, in the creator's own terms. */
function Origin({ item }: { item: Item }) {
  if (item.origin === "suggested")
    return <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">Suggested · not from the reel</span>;
  if (item.origin === "creator")
    return <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">Added by you</span>;
  const label = item.origin === "kb" ? "Checked by WishTrip" : `From the reel${reelTime(item.t) ? ` · ${reelTime(item.t)}` : ""}`;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-semibold text-brand">
      <Play className="size-2.5 fill-current" /> {label}
    </span>
  );
}

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
  const [dirty, setDirty] = useState(false);
  const [choosingCover, setChoosingCover] = useState(false);
  const [choosingThumbnail, setChoosingThumbnail] = useState(false);

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
      unwrap(
        await api.PATCH("/creator/trips/{trip_id}", {
          params: { path: { trip_id: id } },
          body: { title, summary, items: items.filter((i) => i.name.trim()), ...(publish ? { publish: true } : {}) },
        }),
      ),
    onSuccess: (data: Trip) => {
      trip.refetch();
      setItems(data.items);
      setDirty(false);
    },
  });

  if (trip.isLoading || !loaded) return <Spinner />;
  if (trip.error || !trip.data) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="font-sans! text-[26px] font-bold">We couldn&rsquo;t open that trip</h1>
        <p className="mt-2 text-muted">It may belong to another creator account.</p>
        <Link href="/" className="mt-5 inline-flex rounded-full border border-border px-4 py-2 text-sm font-semibold">
          Back to your dashboard
        </Link>
      </div>
    );
  }

  const published = trip.data.status === "published";
  const shareUrl = trip.data.share_code ? `${typeof window !== "undefined" ? window.location.origin : ""}/t/${trip.data.share_code}` : "";
  const filled = items.some((i) => i.name.trim());
  const change = (fn: () => void) => {
    fn();
    setDirty(true);
  };

  // Days as the creator sees them: every day that has a stop, plus the next empty one to add to.
  const dayNumbers = [...new Set(items.map((i) => i.day ?? 1))].sort((a, b) => a - b);
  const days = dayNumbers.length ? dayNumbers : [1];
  const lastDay = days[days.length - 1];
  const dayOf = (it: Item) => it.day ?? 1;

  const setItem = (itemId: string, patch: Partial<Item>) =>
    change(() => setItems(items.map((it) => (it.id === itemId ? { ...it, ...patch } : it))));
  const remove = (itemId: string) => change(() => setItems(items.filter((it) => it.id !== itemId)));
  /** Move a stop up or down within its day, past its neighbour in the same day. */
  const move = (itemId: string, by: -1 | 1) => {
    const at = items.findIndex((it) => it.id === itemId);
    const day = dayOf(items[at]);
    let j = at + by;
    while (j >= 0 && j < items.length && dayOf(items[j]) !== day) j += by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[at], next[j]] = [next[j], next[at]];
    change(() => setItems(next));
  };
  const add = (day: number) => change(() => setItems([...items, blank(day)]));

  return (
    <div className="mx-auto max-w-[1180px] pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-semibold hover:bg-surface-2"
        >
          <ArrowLeft className="size-4" /> Your dashboard
        </Link>
        <span className="flex items-center gap-2 text-[13px]">
          <span
            className={`rounded-full px-3 py-1 text-[12px] font-bold ${published ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}
          >
            {published ? "Published" : "Draft"}
          </span>
          <span className="text-muted" aria-live="polite">
            {save.isPending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
        </span>
      </div>

      <section className="relative isolate mt-4 min-h-[190px] overflow-hidden rounded-[28px] bg-white text-black md:min-h-[220px]">
        {trip.data.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- backend media
          <img src={trip.data.cover_image_url} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
        ) : (
          <span className="absolute inset-0 -z-20 bg-gradient-to-br from-white to-brand" />
        )}
        <span className="absolute inset-0 -z-10 bg-gradient-to-r from-white/70 via-white/30 to-transparent" />
        <div className="flex min-h-[190px] flex-col justify-between gap-5 p-5 md:min-h-[220px] md:p-8">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-bold text-black">Edit your trip</span>
            <span className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setChoosingCover(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                <ImagePlus className="size-4" /> Change cover
              </button>
              <button
                type="button"
                onClick={() => setChoosingThumbnail(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                <ImagePlus className="size-4" /> Change thumbnail
              </button>
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-sans! m-0 text-[30px] font-bold leading-[1.05] tracking-tight md:text-[44px]">
              {title.trim() || "Untitled trip"}
            </h1>
            <p className="m-0 text-[14px] text-black/80">
              {trip.data.destination_name ? `${trip.data.destination_name} · ` : ""}
              {days.length} {days.length === 1 ? "day" : "days"} · {items.filter((i) => i.name.trim()).length} stops
            </p>
          </div>
        </div>
      </section>

      <div className="mt-7 grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-5">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Title
              <input className={FIELD} value={title} onChange={(e) => change(() => setTitle(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Summary
              <textarea
                rows={2}
                className={FIELD}
                placeholder="One or two lines about the trip, in your words"
                value={summary}
                onChange={(e) => change(() => setSummary(e.target.value))}
              />
            </label>
          </section>

          {days.map((day) => {
            const stops = items.filter((it) => dayOf(it) === day);
            return (
              <section key={day} aria-label={`Day ${day}`} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-sans! m-0 text-[20px] font-bold tracking-tight">
                    <span className="mr-2 text-[12px] font-bold uppercase tracking-wider text-danger">Day {day}</span>
                  </h2>
                  <span className="text-xs text-muted">
                    {stops.length} {stops.length === 1 ? "stop" : "stops"}
                  </span>
                </div>

                {stops.map((it, n) => {
                  const kind = kindOf(it.kind);
                  return (
                    <article key={it.id} className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${kind.chip}`}>{kind.label}</span>
                        {it.verified && (
                          <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-[11px] font-bold text-ok">Checked</span>
                        )}
                        <Origin item={it} />
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-[1fr_140px]">
                        <input
                          className={FIELD}
                          placeholder="Name, e.g. Fort Aguada"
                          aria-label="Stop name"
                          value={it.name}
                          onChange={(e) => setItem(it.id, { name: e.target.value })}
                        />
                        <select
                          className={FIELD}
                          aria-label="Type of stop"
                          value={it.kind}
                          onChange={(e) => setItem(it.id, { kind: e.target.value })}
                        >
                          {KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <input
                        className={FIELD}
                        placeholder="A note for travellers (optional)"
                        aria-label="Note"
                        value={it.note}
                        onChange={(e) => setItem(it.id, { note: e.target.value })}
                      />
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <label className="flex items-center gap-2 text-[13px] text-muted">
                          Day
                          <select
                            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[13px] text-text"
                            aria-label="Day"
                            value={day}
                            onChange={(e) => setItem(it.id, { day: Number(e.target.value) })}
                          >
                            {Array.from({ length: lastDay + 1 }, (_, d) => d + 1).map((d) => (
                              <option key={d} value={d}>
                                Day {d}
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => move(it.id, -1)}
                            disabled={n === 0}
                            aria-label="Move up"
                            className="grid size-8 place-items-center rounded-full border border-border hover:bg-surface-2 disabled:opacity-40"
                          >
                            <ArrowUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(it.id, 1)}
                            disabled={n === stops.length - 1}
                            aria-label="Move down"
                            className="grid size-8 place-items-center rounded-full border border-border hover:bg-surface-2 disabled:opacity-40"
                          >
                            <ArrowDown className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(it.id)}
                            className="ml-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                          >
                            <Trash2 className="size-3.5" /> Remove
                          </button>
                        </span>
                      </div>
                    </article>
                  );
                })}

                <button
                  type="button"
                  onClick={() => add(day)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border px-4 py-2 text-sm font-semibold text-muted hover:border-brand hover:text-brand"
                >
                  <Plus className="size-4" /> Add a stop to day {day}
                </button>
              </section>
            );
          })}

          <button
            type="button"
            onClick={() => add(lastDay + 1)}
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-2"
          >
            <Plus className="size-4" /> Add day {lastDay + 1}
          </button>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <div className="flex flex-col gap-3.5 rounded-[22px] border border-border bg-surface p-5">
            <span className="text-[12px] font-bold text-muted">Publishing</span>
            <p className="m-0 text-[24px] font-bold leading-tight tracking-tight">{published ? "Published" : "Not published"}</p>
            <p className="m-0 text-[13px] text-muted">
              {published
                ? "Travellers who open your link see this itinerary. Update it any time."
                : "Nothing is visible to travellers until you publish."}
            </p>
            <button
              type="button"
              onClick={() => save.mutate(true)}
              disabled={save.isPending || !filled}
              className="rounded-full bg-accent p-[14px] text-base font-bold text-[#072338] hover:bg-accent-strong disabled:opacity-60"
            >
              {published ? "Update & keep live" : "Publish & get link"}
            </button>
            <button
              type="button"
              onClick={() => save.mutate(false)}
              disabled={save.isPending || !dirty}
              className="rounded-full border border-border bg-surface p-[12px] text-[15px] font-semibold hover:bg-surface-2 disabled:opacity-50"
            >
              {save.isPending && !save.variables ? "Saving…" : "Save draft"}
            </button>
            {save.error && <p className="m-0 text-[13px] text-danger">{errorMessage(save.error)}</p>}
          </div>

          {published && shareUrl && (
            <div className="flex flex-col gap-2 rounded-[22px] bg-ok-soft p-4">
              <strong className="text-[14px] text-ok">Share this link in your video</strong>
              <span className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px]">
                  {withoutScheme(shareUrl)}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    copyText(shareUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#072338] px-3.5 py-2 text-[13px] font-semibold text-white"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </span>
              <span className="text-[12px] text-ok">Every booking through this link earns your commission.</span>
            </div>
          )}
        </aside>
      </div>

      {choosingCover && <CoverPicker tripId={id} onClose={() => setChoosingCover(false)} />}
      {choosingThumbnail && <CoverPicker tripId={id} kind="thumbnail" onClose={() => setChoosingThumbnail(false)} />}
    </div>
  );
}
