"use client";

import { ArrowLeft, Check, Compass, Copy, Landmark, Play, Utensils, BedDouble } from "lucide-react";
import { useEffect, useState } from "react";

import { reelLink, withoutScheme } from "@/lib/creator";

/**
 * The itinerary made from a creator's reel, laid out like the trip board in the B4 prototype:
 * one column per day, a card per stop, and a note of where in the reel each stop came from.
 *
 * UI only for now — the days below are a sample, not read from the reel yet.
 */

export type Stop = { time: string; kind: "sight" | "food" | "stay" | "experience"; name: string; note: string; at: string };
export type ItineraryDay = { n: number; title: string; stops: Stop[] };

const KIND = {
  sight: { label: "See", Icon: Landmark },
  food: { label: "Eat", Icon: Utensils },
  stay: { label: "Stay", Icon: BedDouble },
  experience: { label: "Do", Icon: Compass },
} as const;

/** A sample three-day itinerary, until reels are really read. */
export function sampleItinerary(): ItineraryDay[] {
  return [
    {
      n: 1,
      title: "Arrive slow",
      stops: [
        { time: "12:30 pm", kind: "stay", name: "Check in at a heritage villa", note: "Ground floor", at: "0:02" },
        { time: "4:00 pm", kind: "sight", name: "Sunset at Fort Aguada", note: "Go before 5", at: "0:04" },
        { time: "8:00 pm", kind: "food", name: "Fish thali in Anjuna", note: "Locals’ pick", at: "0:09" },
      ],
    },
    {
      n: 2,
      title: "Beaches and a long lunch",
      stops: [
        { time: "10:00 am", kind: "food", name: "Slow breakfast at the villa", note: "Easy start", at: "0:11" },
        { time: "1:00 pm", kind: "experience", name: "Morjim beach walk", note: "Flat, short walk", at: "0:15" },
        { time: "6:00 pm", kind: "experience", name: "Mandovi sunset cruise", note: "Lift to the upper deck", at: "0:21" },
      ],
    },
    {
      n: 3,
      title: "Old Panaji",
      stops: [
        { time: "10:00 am", kind: "sight", name: "Fontainhas walking tour", note: "1.5 km", at: "0:24" },
        { time: "1:00 pm", kind: "food", name: "Lunch in a 200-year-old house", note: "From the reel", at: "0:27" },
        { time: "5:00 pm", kind: "sight", name: "Churches of Old Goa", note: "Closes at 6", at: "0:31" },
      ],
    },
  ];
}

export const stopCount = (days: ItineraryDay[]) => days.reduce((n, d) => n + d.stops.length, 0);

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
  title,
  code,
  sources,
  published,
  auto,
  onPublished,
  onAuto,
  onClose,
}: {
  title: string;
  code: string;
  sources: { label: string; url: string }[];
  published: boolean;
  auto: boolean;
  onPublished: (next: boolean) => void;
  onAuto: (next: boolean) => void;
  onClose: () => void;
}) {
  const days = sampleItinerary();
  const short = reelLink(code);
  const [copied, setCopied] = useState(false);

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
        <span className="text-sm text-[#566E85]">Itinerary preview</span>
      </header>

      <main className="mx-auto grid max-w-[1240px] grid-cols-1 items-start gap-8 px-4 pb-16 pt-6 md:grid-cols-[1fr_330px] md:px-10 md:pt-8">
        <section className="flex min-w-0 flex-col gap-3">
          <span className="text-[11.5px] font-bold tracking-wider text-[#0A7C80]">YOUR ITINERARY</span>
          <h1 className="font-display m-0 text-[32px] font-medium leading-tight md:text-[44px]">{title}</h1>
          <p className="m-0 text-sm text-[#566E85]">
            {days.length} days · {stopCount(days)} stops · made from your reel
          </p>

          <p className="mt-2 text-[11.5px] font-bold tracking-wider text-[#566E85]">DAY BY DAY</p>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
            {days.map((d) => (
              <div key={d.n} className="flex w-[250px] flex-none flex-col gap-2 rounded-[20px] bg-[#F4EFE8] p-3">
                <span className="flex flex-col px-1 pt-0.5">
                  <span className="text-[11.5px] font-bold text-[#0A7C80]">DAY {d.n}</span>
                  <strong className="font-display text-lg font-medium leading-[1.2]">{d.title}</strong>
                </span>
                {d.stops.map((s) => {
                  const { label, Icon } = KIND[s.kind];
                  return (
                    <div key={s.name} className="flex items-start gap-2.5 rounded-[14px] border border-[#E8E1D8] bg-white p-2.5">
                      <span className="grid size-10 flex-none place-items-center rounded-[10px] bg-[#F4EFE8] text-[#0A7C80]">
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span className="text-[11px] font-semibold text-[#8A7F72]">
                          {s.time} · {label}
                        </span>
                        <strong className="text-[13.5px] leading-[1.3]">{s.name}</strong>
                        <span className="flex flex-wrap gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#D8F6F7] px-2 py-0.5 text-[10.5px] font-semibold text-[#0A6B6E]">
                            <Play className="size-2.5" /> From the reel · {s.at}
                          </span>
                          <span className="rounded-full bg-[#F4EFE8] px-2 py-0.5 text-[10.5px] font-semibold text-[#566E85]">{s.note}</span>
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="text-xs text-[#8A7F72]">Scroll sideways for all {days.length} days.</p>
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
              onClick={() => onPublished(!published)}
              className={`rounded-full p-[15px] text-center text-base font-bold ${
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
              We watched the reel, read the text on screen, listened to the voice-over, and found the places.
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}
