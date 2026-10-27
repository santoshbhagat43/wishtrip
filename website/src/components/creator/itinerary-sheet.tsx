"use client";

import {
  ArrowLeft,
  BedDouble,
  Check,
  Compass,
  Copy,
  Landmark,
  MessageCircle,
  ImagePlus,
  Pencil,
  Play,
  Share2,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CoverPicker } from "@/components/creator/cover-picker";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "@/lib/api/client";
import { WEBSITE_URL, withoutScheme } from "@/lib/creator";
import { copyText } from "@/lib/clipboard";

/**
 * The itinerary made from a creator's reel, laid out like the trip board in the B4 prototype: one
 * column per day, a card per stop, and a note of where in the reel each stop was seen.
 *
 * The days are the real itinerary read from the reel. The bookings strip is a sample: there are
 * no flight, stay or transfer prices to show yet.
 */

type Item = Schemas["TripItem"];
type Link = Schemas["CreatorLinkRead"];
export type Stop = {
  when: string;
  kind: string;
  name: string;
  note: string;
  at: string | null;
  /** A TripJack photo of the hotel, for a stay whose name matches one. */
  image?: string | null;
  imageHotel?: string | null;
  /** Where it came from: the creator's video, WishTrip's checked places, or a suggestion. */
  origin: "reel" | "kb" | "suggested" | "creator";
};
export type ItineraryDay = { n: number; stops: Stop[] };

const KIND: Record<string, { label: string; Icon: typeof Landmark; chip: string }> = {
  sight: { label: "See", Icon: Landmark, chip: "bg-brand-soft text-brand" },
  food: { label: "Eat", Icon: Utensils, chip: "bg-danger-soft text-danger" },
  stay: { label: "Stay", Icon: BedDouble, chip: "bg-ai-soft text-ai" },
  experience: { label: "Experience", Icon: Compass, chip: "bg-warn-soft text-warn" },
  area: { label: "Explore", Icon: Compass, chip: "bg-info-soft text-info" },
  note: { label: "Note", Icon: Landmark, chip: "bg-surface-2 text-muted" },
};
const WHEN = ["Morning", "Midday", "Afternoon", "Evening"];

/** m:ss into the reel, or nothing when we don't know. */
const reelTime = (t: number | null | undefined) =>
  typeof t === "number" ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : null;

/** The reel's words about a stop, unless they only repeat its name. */
const noteFor = (s: Item) => {
  const note = s.note.trim().toLowerCase();
  const name = s.name.trim().toLowerCase();
  return !note || name.includes(note) || note.includes(name) ? "" : s.note.slice(0, 48);
};

/** The trip's stops as days: the creator's own days if they set them, else about three a day.
 *  With `days`, the same stops in the same order are spread over that many days instead (a
 *  traveller making the trip their own). */
export function daysFromItems(items: Item[], days?: number): ItineraryDay[] {
  const stops = items.filter((i) => i.name.trim());
  const dayOf = (i: number) => {
    if (days) return Math.floor(i / Math.ceil(stops.length / Math.min(days, Math.max(1, stops.length)))) + 1;
    if (stops.some((s) => s.day)) return stops[i].day ?? 1;
    const perDay = Math.ceil(stops.length / Math.min(7, Math.max(1, Math.ceil(stops.length / 3))));
    return Math.floor(i / perDay) + 1;
  };
  const byDay = new Map<number, Stop[]>();
  stops.forEach((s, i) => {
    const day = byDay.get(dayOf(i)) ?? [];
    byDay.set(dayOf(i), [
      ...day,
      {
        when: WHEN[day.length % WHEN.length],
        kind: s.kind,
        name: s.name,
        note: noteFor(s),
        at: s.origin === "reel" ? reelTime(s.t) : null,
        origin: s.origin ?? "reel",
        image: s.image_url ?? null,
        imageHotel: s.image_hotel ?? null,
      },
    ]);
  });
  return [...byDay.entries()].sort(([a], [b]) => a - b).map(([, list], idx) => ({ n: idx + 1, stops: list }));
}

export const stopCount = (days: ItineraryDay[]) => days.reduce((n, d) => n + d.stops.length, 0);

const CARD = "rounded-[22px] border border-border bg-surface";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-none rounded-full transition ${checked ? "bg-brand" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** "Start — Shape your itinerary — Publish", the prototype's three steps, for a reel itinerary. */
function Steps({ published }: { published: boolean }) {
  const step = (n: number, label: string, state: "done" | "now" | "next") => (
    <span className="flex items-center gap-2 text-[13px]">
      <span
        className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${
          state === "done"
            ? "bg-brand-soft text-brand"
            : state === "now"
              ? "bg-[#072338] text-white"
              : "border border-border text-muted"
        }`}
      >
        {state === "done" ? <Check className="size-3.5" /> : n}
      </span>
      <span className={state === "next" ? "text-muted" : "font-semibold"}>{label}</span>
    </span>
  );
  return (
    <nav aria-label="Progress" className="hidden items-center gap-3 md:flex">
      {step(1, "Reel read", "done")}
      <span className="h-px w-8 bg-border" />
      {step(2, "Shape your itinerary", published ? "done" : "now")}
      <span className="h-px w-8 bg-border" />
      {step(3, "Publish", published ? "done" : "next")}
    </nav>
  );
}

/** The day's heading: what the day is about, from its first stops. */
function dayTitle(day: ItineraryDay) {
  const [first, second] = day.stops;
  if (!first) return "A free day";
  if (!second) return `A day at ${first.name}`;
  const more = day.stops.length - 2;
  return `${first.name}, then ${second.name}${more > 0 ? ` + ${more} more` : ""}`;
}

/** The whole-screen itinerary, laid out like the prototype's trip board: a hero, the days as
 *  chips, one day's stops below, and the publishing card beside it. */
export function ItinerarySheet({
  link,
  busy,
  onPublished,
  onAuto,
  onClose,
}: {
  link: Link;
  busy: boolean;
  onPublished: (next: boolean) => void;
  onAuto: (next: boolean) => void;
  onClose: () => void;
}) {
  const title = link.label;
  const published = link.status === "published";
  const auto = link.auto_publish;
  const sources = [
    ...(link.instagram_url ? [{ label: "Instagram", url: link.instagram_url }] : []),
    ...(link.youtube_url ? [{ label: "YouTube", url: link.youtube_url }] : []),
  ];
  const trip = useQuery({
    queryKey: ["trip", link.trip_id],
    enabled: !!link.trip_id,
    queryFn: async () =>
      unwrap(await api.GET("/creator/trips/{trip_id}", { params: { path: { trip_id: link.trip_id! } } })),
    // While suggested stops are still being added in the background, check back for them.
    refetchInterval: (query) => (query.state.data?.completing ? 3000 : false),
  });
  const days = daysFromItems(trip.data?.items ?? []);
  const fromReel = days.reduce((n, d) => n + d.stops.filter((s) => s.origin === "reel").length, 0);
  // What travellers open: the published itinerary.
  const short = link.share_code ? `${WEBSITE_URL}/t/${link.share_code}` : "";
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [picked, setPicked] = useState(0);
  const [choosingCover, setChoosingCover] = useState(false);
  const [choosingThumbnail, setChoosingThumbnail] = useState(false);
  const day = days[Math.min(picked, days.length - 1)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = () => {
    copyText(short);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Itinerary: ${title}`}
      className="fixed inset-0 z-[60] overflow-y-auto bg-bg text-text"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur md:px-10">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-semibold hover:bg-surface-2"
        >
          <ArrowLeft className="size-4" /> Back to reel
        </button>
        <Steps published={published} />
        <span className="hidden w-[120px] lg:block" aria-hidden />
      </header>

      <main className="mx-auto max-w-[1240px] px-4 pb-16 pt-5 md:px-10 md:pt-6">
        <section className="relative isolate min-h-[230px] overflow-hidden rounded-[28px] bg-white text-black md:min-h-[250px]">
          {link.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- backend media
            <img src={link.cover_image_url} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 -z-20 bg-gradient-to-br from-white to-brand" />
          )}
          <span className="absolute inset-0 -z-10 bg-gradient-to-r from-white/70 via-white/30 to-transparent" />
        <div className="flex min-h-[230px] flex-col justify-between gap-6 p-5 md:min-h-[250px] md:p-8">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[13px] font-bold text-black">Your itinerary</span>
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={sharing}
                  onClick={() => setSharing((open) => !open)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
                >
                  <Share2 className="size-4" /> Share with family
                </button>
                {sharing && (
                  <div
                    role="group"
                    aria-label="Share with family"
                    className="absolute right-0 top-[calc(100%+8px)] z-20 flex w-[300px] flex-col gap-2.5 rounded-2xl border border-border bg-surface p-4 text-text shadow-lg"
                  >
                    <strong className="text-sm">Send it to the people coming with you</strong>
                    <code className="break-all rounded-lg bg-surface-2 px-2.5 py-2 text-[12.5px]">
                      {short ? withoutScheme(short) : "Appears here once you publish"}
                    </code>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!short}
                        onClick={copy}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#072338] px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
                      >
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied ? "Copied" : "Copy link"}
                      </button>
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(`${title} — ${short}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-disabled={!short}
                        className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[13px] font-semibold ${short ? "" : "pointer-events-none opacity-40"}`}
                      >
                        <MessageCircle className="size-3.5" /> WhatsApp
                      </a>
                    </div>
                    {!published && <span className="text-xs text-muted">Publish the itinerary first, so they can open it.</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-2">
                <h1 className="font-sans! m-0 text-[34px] font-bold leading-[1.02] tracking-tight md:text-[52px]">{title}</h1>
                <p className="m-0 text-[14px] text-black/80">
                  {trip.isLoading
                    ? "Loading…"
                    : `${days.length} days · ${stopCount(days)} stops · ${fromReel} from your reel`}
                </p>
                {link.trip_id && (
                  <span className="mt-1 flex flex-wrap gap-2">
                    <Link
                      href={`/trips/${link.trip_id}`}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-black/60 px-4 py-2 text-[13px] font-semibold text-black hover:bg-black/5"
                    >
                      <Pencil className="size-3.5" /> Edit trip
                    </Link>
                    <button
                      type="button"
                      onClick={() => setChoosingCover(true)}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-black/60 px-4 py-2 text-[13px] font-semibold text-black hover:bg-black/5"
                    >
                      <ImagePlus className="size-3.5" /> Change cover
                    </button>
                    <button
                      type="button"
                      onClick={() => setChoosingThumbnail(true)}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-black/60 px-4 py-2 text-[13px] font-semibold text-black hover:bg-black/5"
                    >
                      <ImagePlus className="size-3.5" /> Change thumbnail
                    </button>
                  </span>
                )}
              </div>
              {sources[0] ? (
                <a
                  href={sources[0].url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-full bg-white/95 py-2 pl-2 pr-6 text-black shadow-lg"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-black/10 text-black">
                    <Play className="size-4 fill-current" />
                  </span>
                  <span className="flex flex-col text-left leading-tight">
                    <strong className="text-[15px]">Watch the reel</strong>
                    <span className="text-xs text-black/70">From your reel</span>
                  </span>
                </a>
              ) : (
                <span className="rounded-full bg-white/95 px-5 py-3 text-xs font-semibold text-black">From your video</span>
              )}
            </div>
          </div>
        </section>

        <div className="mt-7 grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_340px]">
          <section className="flex min-w-0 flex-col gap-4">
            {trip.isLoading ? (
              <p className="py-8 text-sm text-muted">Loading your itinerary…</p>
            ) : (
              <>
                {trip.data?.completing && (
                  <p
                    role="status"
                    className="m-0 flex items-center gap-2.5 rounded-2xl bg-brand-soft px-4 py-3 text-[14px] text-brand"
                  >
                    <span className="size-2 shrink-0 animate-pulse rounded-full bg-brand" aria-hidden />
                    These are the places from your video. We&rsquo;re adding suggestions so every day is full;
                    they&rsquo;ll appear here in about a minute.
                  </p>
                )}
                <p className="m-0 text-[13px] text-muted">Tap a day to see its stops</p>
                <div role="tablist" aria-label="Days" className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                  {days.map((d, i) => {
                    const { Icon } = KIND[d.stops[0]?.kind] ?? KIND.sight;
                    const on = day?.n === d.n;
                    return (
                      <button
                        key={d.n}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => setPicked(i)}
                        className={`flex flex-none items-center gap-2.5 rounded-[18px] bg-surface py-2 pl-2 pr-4 text-left transition ${
                          on ? "border-2 border-danger shadow-sm" : "border border-border hover:bg-surface-2"
                        }`}
                      >
                        <span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-brand">
                          <Icon className="size-[18px]" />
                        </span>
                        <span className="flex flex-col leading-tight">
                          <strong className="text-[14px]">Day {d.n}</strong>
                          <span className="text-xs text-muted">
                            {d.stops.length} {d.stops.length === 1 ? "stop" : "stops"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {day && (
                  <div role="tabpanel" aria-label={`Day ${day.n}`} className="flex flex-col gap-3">
                    <div className="mt-2 flex items-baseline justify-between gap-3">
                      <span className="text-[12px] font-bold uppercase tracking-wider text-danger">Day {day.n}</span>
                      <span className="text-xs text-muted">
                        {day.stops.length} {day.stops.length === 1 ? "plan" : "plans"}
                      </span>
                    </div>
                    <h2 className="font-sans -mt-1 mb-1 text-[26px] font-bold leading-tight tracking-tight md:text-[30px]">
                      {dayTitle(day)}
                    </h2>
                    {day.stops.map((s, i) => {
                      const { label, Icon, chip } = KIND[s.kind] ?? KIND.sight;
                      return (
                        <article key={`${s.name}-${i}`} className={`${CARD} flex overflow-hidden`}>
                          <div className="relative grid w-[96px] flex-none place-items-center bg-gradient-to-br from-surface-2 to-brand-soft text-brand md:w-[180px]">
                            {s.image ? (
                              // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
                              <img src={s.image} alt={s.imageHotel ?? s.name} className="absolute inset-0 size-full object-cover" loading="lazy" />
                            ) : (
                              <Icon className="size-9 md:size-12" strokeWidth={1.5} />
                            )}
                            <span className="absolute left-3 top-3 rounded-full bg-[#072338] px-2.5 py-1 text-[11px] font-bold text-white">
                              {s.when}
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 md:p-5">
                            <span className={`w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold ${chip}`}>{label}</span>
                            <strong className="text-[19px] leading-snug md:text-[21px]">{s.name}</strong>
                            {s.image && s.imageHotel && (
                              <span className="-mt-1 text-[11px] text-muted">Photo: {s.imageHotel} · via TripJack</span>
                            )}
                            <span className="flex flex-wrap gap-1.5">
                              {s.origin === "suggested" ? (
                                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                                  Wishtrip recommended
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-semibold text-brand">
                                  <Play className="size-2.5 fill-current" />{" "}
                                  {s.origin === "kb"
                                    ? "Checked by WishTrip"
                                    : s.origin === "creator"
                                      ? "Added by you"
                                      : `From the reel${s.at ? ` · ${s.at}` : ""}`}
                                </span>
                              )}
                              {s.note && (
                                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">{s.note}</span>
                              )}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

              </>
            )}
          </section>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
            <div className={`${CARD} flex flex-col gap-3.5 p-5`}>
              <span className="text-[12px] font-bold text-muted">Publishing</span>
              <p className="m-0 flex items-center gap-2 text-[26px] font-bold leading-tight tracking-tight">
                {published ? (
                  <>
                    <span className="grid size-6 place-items-center rounded-full bg-ok text-white">
                      <Check className="size-3.5" />
                    </span>
                    Published
                  </>
                ) : (
                  "Not published"
                )}
              </p>
              <p className="m-0 text-[13px] text-muted">
                {published
                  ? "Travellers who open your reel link see this itinerary."
                  : "Check the days, then publish it. Nothing is visible to travellers until you do."}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPublished(!published)}
                className={`rounded-full p-[15px] text-center text-base font-bold disabled:opacity-60 ${
                  published ? "border border-border bg-surface text-text hover:bg-surface-2" : "bg-accent text-[#072338] hover:bg-accent-strong"
                }`}
              >
                {published ? "Unpublish" : "Publish itinerary"}
              </button>
              <div className="flex items-start justify-between gap-3 border-t border-border pt-3.5">
                <span className="flex flex-col gap-0.5 text-[13px]">
                  <strong>Publish automatically</strong>
                  <span className="text-muted">Next time, publish as soon as the itinerary is built.</span>
                </span>
                <Switch checked={auto} onChange={onAuto} label="Publish automatically" />
              </div>
            </div>

            {published && (
              <div className="flex flex-col gap-2 rounded-[22px] bg-ok-soft p-4">
                <strong className="text-[14px] text-ok">Share this link</strong>
                <span className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px]">
                    {withoutScheme(short)}
                  </code>
                  <button
                    type="button"
                    onClick={copy}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#072338] px-3.5 py-2 text-[13px] font-semibold text-white"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </span>
                <span className="text-[12px] text-ok">Every booking through it earns your commission.</span>
              </div>
            )}

            <div className={`${CARD} flex flex-col gap-2 p-5`}>
              <span className="text-[12px] font-bold text-muted">Made from</span>
              {sources.length === 0 && <strong className="text-[13.5px]">A video you uploaded</strong>}
              {sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 text-[13.5px] hover:underline">
                  <strong>{s.label}</strong>
                  <span className="min-w-0 truncate text-muted">{withoutScheme(s.url)}</span>
                </a>
              ))}
              <span className="text-xs text-muted">
                We downloaded the reel, read the text on screen, listened to the voice-over, and found the places.
              </span>
            </div>
          </aside>
        </div>
      </main>
      {choosingCover && link.trip_id && <CoverPicker tripId={link.trip_id} onClose={() => setChoosingCover(false)} />}
      {choosingThumbnail && link.trip_id && (
        <CoverPicker tripId={link.trip_id} kind="thumbnail" onClose={() => setChoosingThumbnail(false)} />
      )}
    </div>
  );
}
