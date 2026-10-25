"use client";

import { useQuery } from "@tanstack/react-query";
import { BedDouble, Compass, Landmark, Utensils } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { daysFromItems, type ItineraryDay } from "@/components/creator/itinerary-sheet";
import { api, unwrap } from "@/lib/api/client";
import { useMe } from "@/lib/session";

import { LINKS } from "../data";
import { FlowHeader, Kicker, Why } from "../flow";
import { copyText } from "@/lib/clipboard";

const KIND_ICON: Record<string, typeof Landmark> = {
  sight: Landmark,
  food: Utensils,
  stay: BedDouble,
  experience: Compass,
  area: Compass,
  note: Landmark,
};

/** The sample prices from the prototype's board. Real prices come at checkout. */
const PRICE_ROWS = [
  ["Flights · 3 seats", "₹19,800"],
  ["Stay", "₹14,400"],
  ["Experiences & meals", "₹5,400"],
  ["Transfers", "₹3,200"],
  ["Taxes & fees", "₹3,400"],
] as const;

const BOOKING = "flex flex-col gap-2 rounded-[18px] border border-[#E3E8EE] bg-white p-3.5";

/** What the board says about each booking. The wording follows the prototype; the destination
 *  is the trip's own, and the prices are samples. */
function bookings(where: string, nights: number) {
  return [
    {
      kind: "FLIGHTS",
      price: "₹19,800",
      title: `Your city ⇄ ${where}`,
      detail: "Return · dates and seats at checkout",
      chip: "Cheapest, seats together",
    },
    {
      kind: "STAY",
      price: "₹14,400",
      title: `A stay in ${where}`,
      detail: `${nights} ${nights === 1 ? "night" : "nights"} · rooms at checkout`,
      chip: "Ground floor on request",
      swap: "Swap this stay",
    },
    {
      kind: "TRANSFERS",
      price: "₹3,200",
      title: "Private car, same driver",
      detail: "Airport both ways + day trips",
      chip: "Short drives only",
    },
  ];
}

/**
 * A creator's shared trip (wishtrip…/t/<code>), laid out as the B4 trip board: bookings on the
 * board, the days from the creator's reel, one price, and Arya to change anything. The stops are
 * the creator's own; the bookings and prices are the prototype's samples until bookings are live.
 */
export function SharedTripScreen() {
  const { code } = useParams<{ code: string }>();
  const me = useMe();
  const trip = useQuery({
    queryKey: ["public-trip", code],
    retry: false,
    queryFn: async () => {
      const r = await api.GET("/trips/{share_code}", { params: { path: { share_code: code } } });
      return r.response.status === 404 ? null : unwrap(r);
    },
  });
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Credit the creator once we know who they are.
  const referralCode = trip.data?.creator.referral_code;
  useEffect(() => {
    if (!referralCode) return;
    fetch("/api/creator-visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referralCode }),
    }).catch(() => {});
  }, [referralCode]);

  const name = me.data ? (me.data.full_name || me.data.email.split("@")[0]) : undefined;
  const header = (title: string, subtitle: string) => (
    <FlowHeader step={2} title={title} subtitle={subtitle} back={LINKS.home} signedIn={!!me.data} traveller={name} />
  );

  if (trip.isLoading) {
    return (
      <div className="min-h-dvh bg-[#FFFFFF]">
        {header("Trip board", "Loading")}
        <p className="p-10 text-center text-[#566E85]">Loading the trip board…</p>
      </div>
    );
  }
  if (!trip.data) {
    return (
      <div className="min-h-dvh bg-[#FFFFFF]">
        {header("Trip board", "Not available")}
        <main className="mx-auto max-w-[640px] px-6 py-16">
          <h1 className="font-display text-[32px] font-medium leading-tight">This trip isn’t available</h1>
          <p className="mt-2 text-[#566E85]">The link may be wrong, or the creator unpublished it.</p>
          <Link href={LINKS.home} className="mt-6 inline-block rounded-full bg-[#22DDE0] px-6 py-3 text-base font-bold text-[#072338] no-underline">
            Explore wishtrip
          </Link>
        </main>
      </div>
    );
  }

  const t = trip.data;
  const who = t.creator.display_name || (t.creator.handle ? `@${t.creator.handle}` : "a creator");
  const where = t.destination_name || "your trip";
  const days = daysFromItems(t.items);
  const stops = days.reduce((n, d) => n + d.stops.length, 0);
  const seed = `Plan a trip to ${where}${
    t.items.length ? `. I want to see: ${t.items.filter((i) => i.kind !== "note").map((i) => i.name).slice(0, 10).join(", ")}` : ""
  }.`;
  const plan = (extra = "") => `${LINKS.start}?prompt=${encodeURIComponent(seed + extra)}`;
  const here = typeof window === "undefined" ? "" : window.location.href;

  return (
    <div className="min-h-dvh bg-[#FFFFFF] text-[#0D2436]">
      {header(t.title, `${days.length} ${days.length === 1 ? "day" : "days"} · by ${who}`)}

      <main className="mx-auto grid max-w-[1320px] grid-cols-1 items-start gap-7 px-4 pb-16 pt-6 md:grid-cols-[1fr_330px] md:px-10 md:pb-[72px] md:pt-8">
        <section className="flex min-w-0 flex-col gap-[22px]">
          {t.cover_image_url && (
            <div className="relative h-52 overflow-hidden rounded-[22px] md:h-60">
              {/* eslint-disable-next-line @next/next/no-img-element -- backend media */}
              <img src={t.cover_image_url} alt="" className="absolute inset-0 size-full object-cover" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <Kicker teal>A TRIP BY {who.toUpperCase()}</Kicker>
              <h1 className="font-display mb-0 mt-1.5 text-[32px] font-medium leading-[1.08] md:text-[44px]">{t.title}</h1>
              <p className="mt-1.5 text-[15px] text-[#566E85]">
                {days.length} {days.length === 1 ? "day" : "days"} · {stops} stops ·{" "}
                {days.reduce((n, d) => n + d.stops.filter((s) => s.origin === "reel").length, 0)} from {who}’s reel
              </p>
              {t.summary && <p className="mt-2 max-w-[640px] text-[14.5px] text-[#3F5A72]">{t.summary}</p>}
            </div>
            <div className="relative flex gap-2">
              <button
                type="button"
                aria-expanded={sharing}
                onClick={() => setSharing((open) => !open)}
                className="rounded-full border-[1.5px] border-[#E3E8EE] bg-white px-4 py-2.5 text-sm font-semibold text-[#0D2436]"
              >
                Share with family
              </button>
              {sharing && (
                <div
                  role="group"
                  aria-label="Share with family"
                  className="absolute right-0 top-[calc(100%+8px)] z-10 flex w-[300px] flex-col gap-2.5 rounded-2xl border border-[#E3E8EE] bg-white p-4 shadow-lg"
                >
                  <strong className="text-sm">Send it to the people coming with you</strong>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        copyText(here);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="flex-1 rounded-full bg-[#072338] px-3.5 py-2 text-[13px] font-semibold text-white"
                    >
                      {copied ? "Copied" : "Copy link"}
                    </button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(`${t.title} — ${here}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 rounded-full border-[1.5px] border-[#E3E8EE] px-3.5 py-2 text-center text-[13px] font-semibold text-[#0D2436] no-underline"
                    >
                      WhatsApp
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <Kicker>BOOKINGS ON YOUR BOARD</Kicker>
            <div className="grid gap-3 sm:grid-cols-3">
              {bookings(where, Math.max(1, days.length - 1)).map((b) => (
                <div key={b.kind} className={BOOKING}>
                  <span className="flex items-center justify-between">
                    <Kicker>{b.kind}</Kicker>
                    <strong className="text-sm tabular-nums">{b.price}</strong>
                  </span>
                  <strong className="text-[15px]">{b.title}</strong>
                  <span className="text-[12.5px] text-[#566E85]">{b.detail}</span>
                  <span className="flex flex-col items-start gap-1.5">
                    <Why>{b.chip}</Why>
                    {b.swap && <span className="text-[12.5px] font-semibold text-[#0A7C80]">{b.swap}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <Kicker>DAY BY DAY</Kicker>
            <div className="grid auto-cols-[236px] grid-flow-col gap-2.5 overflow-x-auto pb-1.5">
              {days.map((d: ItineraryDay) => (
                <div key={d.n} className="flex min-w-0 flex-col gap-2 rounded-[20px] bg-[#F3F6F9] p-3">
                  <span className="flex flex-col gap-px px-1 pb-1.5 pt-0.5">
                    <span className="text-[11.5px] font-bold text-[#0A7C80]">DAY {d.n}</span>
                    <strong className="font-display line-clamp-2 text-lg font-medium leading-[1.2]">
                      {d.stops
                        .slice(0, 2)
                        .map((s) => s.name)
                        .join(" and ")}
                    </strong>
                  </span>
                  {d.stops.map((s, i) => {
                    const Icon = KIND_ICON[s.kind] ?? Landmark;
                    return (
                      <div key={`${s.name}-${i}`} className="flex items-center gap-2.5 rounded-[14px] border border-[#E3E8EE] bg-white p-2.5">
                        <span aria-hidden="true" className="grid size-11 flex-none place-items-center rounded-[10px] bg-[#F3F6F9] text-[#3F5A72]">
                          <Icon className="size-[18px]" strokeWidth={1.8} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <span className="text-[11.5px] font-semibold text-[#5F6B78]">{s.when}</span>
                          <strong className="text-[13.5px] leading-[1.3]">{s.name}</strong>
                          <span className="self-start">
                            {s.origin === "suggested" ? (
                              <span className="inline-flex max-w-full items-center truncate rounded-full bg-[#EEF2F6] px-[9px] py-0.5 text-[10.5px] font-bold text-[#3F5A72]">
                                Suggested · not from the reel
                              </span>
                            ) : (
                              <Why>
                                {s.origin === "kb"
                                  ? "Checked by WishTrip"
                                  : s.origin === "creator"
                                    ? "Added by the creator"
                                    : `From the reel${s.at ? ` · ${s.at}` : ""}`}
                              </Why>
                            )}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <span className="text-[12.5px] text-[#5F6B78]">
              Scroll sideways for all {days.length} {days.length === 1 ? "day" : "days"}
            </span>
          </div>
        </section>

        <aside className="flex flex-col gap-3.5 md:sticky md:top-[100px]">
          <div className="flex flex-col gap-2.5 rounded-[22px] border border-[#E3E8EE] bg-white p-5">
            <Kicker>ONE PRICE, EVERYTHING IN</Kicker>
            {PRICE_ROWS.map(([label, price]) => (
              <span key={label} className="flex justify-between text-[13.5px] text-[#3F5A72]">
                <span>{label}</span>
                <span className="font-semibold tabular-nums text-[#0D2436]">{price}</span>
              </span>
            ))}
            <span className="mt-0.5 flex items-baseline justify-between border-t border-[#E8EDF2] pt-3">
              <strong className="text-[15px]">Total for 3</strong>
              <strong className="text-[30px] tabular-nums">₹46,200</strong>
            </span>
            <Link
              href={plan()}
              className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline shadow-[0_10px_26px_rgba(18,201,206,.3)]"
            >
              Book in one go
            </Link>
            <span className="text-center text-xs text-[#566E85]">Nothing is charged until you choose at checkout</span>
            <span className="text-center text-[11px] text-[#5F6B78]">Sample prices while bookings are being set up.</span>
          </div>

          <div className="flex flex-col gap-2.5 rounded-[22px] border border-[#E3E8EE] bg-white p-4">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="font-display grid size-[34px] flex-none place-items-center rounded-full text-[18px] font-semibold italic text-white"
                style={{ background: "linear-gradient(135deg,#22DDE0 0%,#1A6094 100%)" }}
              >
                A
              </span>
              <strong className="text-[15px]">Change anything with Arya</strong>
            </span>
            <span className="text-[13px] text-[#566E85]">Say it in your words. The board and the price update.</span>
            <span className="flex flex-wrap gap-1.5">
              {[
                ["Add a sunset cruise", ". Add a sunset cruise."],
                [`Make day ${Math.min(3, days.length)} easier`, `. Make day ${Math.min(3, days.length)} easier.`],
              ].map(([label, extra]) => (
                <Link
                  key={label}
                  href={plan(extra)}
                  className="rounded-full border-[1.5px] border-[#BDEFF0] px-[11px] py-[7px] text-[12.5px] font-semibold text-[#0A7C80] no-underline"
                >
                  {label}
                </Link>
              ))}
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}
