"use client";

import { ArrowLeft, BedDouble, Check, Compass, Copy, Landmark, MessageCircle, Play, Share2, Utensils } from "lucide-react";
import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "@/lib/api/client";
import { WEBSITE_URL, withoutScheme } from "@/lib/creator";

/**
 * The itinerary made from a creator's reel, laid out like the trip board in the B4 prototype: one
 * column per day, a card per stop, and a note of where in the reel each stop was seen.
 *
 * The days are the real itinerary read from the reel. The bookings strip is a sample: there are
 * no flight, stay or transfer prices to show yet.
 */

type Item = Schemas["TripItem"];
type Link = Schemas["CreatorLinkRead"];
export type Stop = { when: string; kind: string; name: string; note: string; at: string | null };
export type ItineraryDay = { n: number; stops: Stop[] };

const KIND: Record<string, { label: string; Icon: typeof Landmark }> = {
  sight: { label: "See", Icon: Landmark },
  food: { label: "Eat", Icon: Utensils },
  stay: { label: "Stay", Icon: BedDouble },
  experience: { label: "Do", Icon: Compass },
  area: { label: "Explore", Icon: Compass },
  note: { label: "Note", Icon: Landmark },
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

/** The trip's stops as days: the creator's own days if they set them, else about three a day. */
export function daysFromItems(items: Item[]): ItineraryDay[] {
  const stops = items.filter((i) => i.name.trim());
  const dayOf = (i: number) => {
    if (stops.some((s) => s.day)) return stops[i].day ?? 1;
    const perDay = Math.ceil(stops.length / Math.min(7, Math.max(1, Math.ceil(stops.length / 3))));
    return Math.floor(i / perDay) + 1;
  };
  const days = new Map<number, Stop[]>();
  stops.forEach((s, i) => {
    const day = days.get(dayOf(i)) ?? [];
    days.set(dayOf(i), [
      ...day,
      { when: WHEN[day.length % WHEN.length], kind: s.kind, name: s.name, note: noteFor(s), at: reelTime(s.t) },
    ]);
  });
  return [...days.entries()].sort(([a], [b]) => a - b).map(([, list], idx) => ({ n: idx + 1, stops: list }));
}

export const stopCount = (days: ItineraryDay[]) => days.reduce((n, d) => n + d.stops.length, 0);

type Booking = { kind: string; price: string; title: string; detail: string; chip: string; swap?: string };

/** What travellers can book with the itinerary. Sample details and prices, as in the prototype. */
const BOOKINGS: Booking[] = [
  {
    kind: "FLIGHTS",
    price: "₹19,800",
    title: "BLR ⇄ GOI · IndiGo",
    detail: "12 Dec 8:10 am · 16 Dec 6:30 pm · 3 seats",
    chip: "Cheapest, seats together",
  },
  {
    kind: "STAY",
    price: "₹14,400",
    title: "Assagao heritage villa",
    detail: "2 ground-floor rooms · 4 nights",
    chip: "Ground floor for Mum",
    swap: "Swap for Siolim (−₹6,200)",
  },
  {
    kind: "TRANSFERS",
    price: "₹3,200",
    title: "Private SUV, same driver",
    detail: "Airport both ways + 3 day trips",
    chip: "Short drives only",
  },
];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-none rounded-full transition ${checked ? "bg-[#0A7C80]" : "bg-[#D9D2C7]"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** The whole-screen itinerary: the day-by-day board and the publishing card beside it. */
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
  });
  const days = daysFromItems(trip.data?.items ?? []);
  // What travellers open: the published itinerary.
  const short = link.share_code ? `${WEBSITE_URL}/t/${link.share_code}` : "";
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Itinerary: ${title}`}
      className="fixed inset-0 z-[60] overflow-y-auto bg-[#FBF8F4] text-[#072338]"
    >
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[#E8E1D8] bg-[#FBF8F4]/95 px-4 py-3 backdrop-blur md:px-10">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E8E1D8] bg-white px-3.5 py-2 text-sm font-semibold"
        >
          <ArrowLeft className="size-4" /> Back to reel
        </button>
        <span className="text-sm text-[#566E85]">Your itinerary · the bookings below are samples</span>
      </header>

      <main className="mx-auto grid max-w-[1240px] grid-cols-1 items-start gap-8 px-4 pb-16 pt-6 md:grid-cols-[1fr_330px] md:px-10 md:pt-8">
        <section className="flex min-w-0 flex-col gap-3">
          {link.cover_image_url && (
            <div className="relative mb-2 h-52 overflow-hidden rounded-[22px] md:h-64">
              {/* eslint-disable-next-line @next/next/no-img-element -- backend media */}
              <img src={link.cover_image_url} alt="" className="absolute inset-0 size-full object-cover" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
              <span className="absolute bottom-3 left-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-[#072338]">
                <Play className="size-3" /> From your reel
              </span>
            </div>
          )}
          <span className="text-[11.5px] font-bold tracking-wider text-[#0A7C80]">YOUR ITINERARY</span>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="font-display m-0 text-[32px] font-medium leading-tight md:text-[44px]">{title}</h1>
              <p className="m-0 text-sm text-[#566E85]">
                {trip.isLoading ? "Loading…" : `${days.length} ${days.length === 1 ? "day" : "days"} · ${stopCount(days)} stops · made from your reel`}
              </p>
            </div>
            <div className="relative">
              <button
                type="button"
                aria-expanded={sharing}
                onClick={() => setSharing((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#E8E1D8] bg-white px-4 py-2 text-sm font-semibold"
              >
                <Share2 className="size-4" /> Share with family
              </button>
              {sharing && (
                <div
                  role="group"
                  aria-label="Share with family"
                  className="absolute right-0 top-[calc(100%+8px)] z-20 flex w-[300px] flex-col gap-2.5 rounded-2xl border border-[#E8E1D8] bg-white p-4 shadow-lg"
                >
                  <strong className="text-sm">Send it to the people coming with you</strong>
                  <code className="break-all rounded-lg bg-[#F4EFE8] px-2.5 py-2 text-[12.5px]">
                    {short ? withoutScheme(short) : "Appears here once you publish"}
                  </code>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!short}
                      onClick={() => {
                        navigator.clipboard.writeText(short);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
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
                      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#E8E1D8] px-3.5 py-2 text-[13px] font-semibold ${short ? "" : "pointer-events-none opacity-40"}`}
                    >
                      <MessageCircle className="size-3.5" /> WhatsApp
                    </a>
                  </div>
                  {!published && (
                    <span className="text-xs text-[#8A7F72]">Publish the itinerary first, so they can open it.</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 text-[11.5px] font-bold tracking-wider text-[#566E85]">BOOKINGS ON YOUR BOARD</p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {BOOKINGS.map((b) => (
              <div key={b.kind} className="flex flex-col gap-1 rounded-[16px] border border-[#E8E1D8] bg-white p-3.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold tracking-wider text-[#8A7F72]">{b.kind}</span>
                  <strong className="text-[15px]">{b.price}</strong>
                </span>
                <strong className="text-[14px] leading-snug">{b.title}</strong>
                <span className="text-[12.5px] text-[#566E85]">{b.detail}</span>
                <span className="mt-1 flex flex-col items-start gap-1">
                  <span className="rounded-full bg-[#D8F6F7] px-2 py-0.5 text-[10.5px] font-semibold text-[#0A6B6E]">{b.chip}</span>
                  {b.swap && <span className="text-[12px] font-semibold text-[#0A7C80]">{b.swap}</span>}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-2 text-[11.5px] font-bold tracking-wider text-[#566E85]">DAY BY DAY</p>
          {trip.isLoading ? (
            <p className="py-8 text-sm text-[#566E85]">Loading your itinerary…</p>
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
              {days.map((d) => (
                <div key={d.n} className="flex w-[250px] flex-none flex-col gap-2 rounded-[20px] bg-[#F4EFE8] p-3">
                  <span className="flex flex-col px-1 pt-0.5">
                    <span className="text-[11.5px] font-bold text-[#0A7C80]">DAY {d.n}</span>
                    <strong className="font-display text-lg font-medium leading-[1.2]">
                      {d.stops.length} {d.stops.length === 1 ? "stop" : "stops"}
                    </strong>
                  </span>
                  {d.stops.map((s, i) => {
                    const { label, Icon } = KIND[s.kind] ?? KIND.sight;
                    return (
                      <div key={`${s.name}-${i}`} className="flex items-start gap-2.5 rounded-[14px] border border-[#E8E1D8] bg-white p-2.5">
                        <span className="grid size-10 flex-none place-items-center rounded-[10px] bg-[#F4EFE8] text-[#0A7C80]">
                          <Icon className="size-[18px]" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <span className="text-[11px] font-semibold text-[#8A7F72]">
                            {s.when} · {label}
                          </span>
                          <strong className="text-[13.5px] leading-[1.3]">{s.name}</strong>
                          <span className="flex flex-wrap gap-1">
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#D8F6F7] px-2 py-0.5 text-[10.5px] font-semibold text-[#0A6B6E]">
                              <Play className="size-2.5" /> From the reel{s.at ? ` · ${s.at}` : ""}
                            </span>
                            {s.note && (
                              <span className="rounded-full bg-[#F4EFE8] px-2 py-0.5 text-[10.5px] font-semibold text-[#566E85]">{s.note}</span>
                            )}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-[#8A7F72]">Scroll sideways to see every day.</p>
        </section>

        <aside className="flex flex-col gap-4 md:sticky md:top-20">
          <div className="flex flex-col gap-3.5 rounded-[22px] border border-[#E8E1D8] bg-white p-5">
            <span className="text-[11.5px] font-bold tracking-wider text-[#566E85]">PUBLISHING</span>
            <p className="m-0 flex items-center gap-2 text-[15px] font-semibold">
              {published ? (
                <>
                  <span className="grid size-5 place-items-center rounded-full bg-[#0B7A57] text-white">
                    <Check className="size-3" />
                  </span>
                  Published
                </>
              ) : (
                "Ready to publish"
              )}
            </p>
            <p className="m-0 text-[13px] text-[#566E85]">
              {published
                ? "Travellers who open your reel link see this itinerary."
                : "Check the days, then publish it. Nothing is visible to travellers until you do."}
            </p>

            <button
              type="button"
              disabled={busy}
              onClick={() => onPublished(!published)}
              className={`rounded-full p-[15px] text-center text-base font-bold disabled:opacity-60 ${
                published ? "border border-[#E8E1D8] bg-white text-[#072338]" : "bg-[#22DDE0] text-[#072338]"
              }`}
            >
              {published ? "Unpublish" : "Publish itinerary"}
            </button>

            <div className="flex items-start justify-between gap-3 border-t border-[#EDE6DC] pt-3.5">
              <span className="flex flex-col gap-0.5 text-[13px]">
                <strong>Publish automatically</strong>
                <span className="text-[#566E85]">Next time, publish as soon as the itinerary is built.</span>
              </span>
              <Switch checked={auto} onChange={onAuto} label="Publish automatically" />
            </div>
          </div>

          {published && (
            <div className="flex flex-col gap-2 rounded-[22px] bg-[#E3F5EE] p-4">
              <strong className="text-[14px] text-[#0B7A57]">Share this link</strong>
              <span className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-[#BDEFF0] bg-white px-2.5 py-2 text-[12.5px]">
                  {withoutScheme(short)}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(short);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#072338] px-3.5 py-2 text-[13px] font-semibold text-white"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </span>
              <span className="text-[12px] text-[#0B7A57]">Every booking through it earns your commission.</span>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-[22px] border border-[#E8E1D8] bg-white p-5">
            <span className="text-[11.5px] font-bold tracking-wider text-[#566E85]">MADE FROM</span>
            {sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 text-[13.5px] hover:underline">
                <strong>{s.label}</strong>
                <span className="min-w-0 truncate text-[#566E85]">{withoutScheme(s.url)}</span>
              </a>
            ))}
            <span className="text-xs text-[#8A7F72]">
              We downloaded the reel, read the text on screen, listened to the voice-over, and found the places.
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}
