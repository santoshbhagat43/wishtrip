"use client";

import Image from "next/image";
import Link from "next/link";

import { LINKS } from "../data";
import { B4Header } from "../header";
import { CARD, Kicker } from "../flow";
import { Play } from "../icons";

const A = (f: string) => `/b4/${f}`;
const ROUTE = ["Candolim", "Anjuna", "Panaji", "Old Goa", "Morjim"];
const planThis = `${LINKS.start}?prompt=${encodeURIComponent(
  "Plan a 5-day North Goa trip from Ananya's reel: Candolim, Anjuna, Panaji, Old Goa, Morjim.",
)}`;

const DAYS = [
  { n: 1, place: "Candolim", title: "Arrive slow", body: "Settle into a ground-floor stay, sunset at Fort Aguada.", img: A("goa-aguada-fort-9x16.webp"), t: "0:04" },
  { n: 2, place: "Anjuna", title: "Markets and shacks", body: "Wednesday flea market, a long beach-shack lunch.", img: A("goa-day1-calangute-umbrellas.webp"), t: "0:11" },
  { n: 3, place: "Panaji", title: "Old Panaji on foot", body: "Fontainhas lanes, fish thali at Ritz Classic.", img: A("goa-day3-panaji-street.webp"), t: "0:19" },
  { n: 4, place: "Old Goa", title: "Churches and cafes", body: "Step-free cathedrals, a quiet riverside evening.", img: A("goa-day3-panaji-church.webp"), t: "0:26" },
  { n: 5, place: "Morjim", title: "The quiet north", body: "Flat, calm beach for the last slow morning.", img: A("goa-day5-morjim-shore.webp"), t: "0:33" },
];

const STATS = [
  ["182k", "views"],
  ["9.4k", "saves"],
  ["312", "booked this trip"],
];

/** A creator's published trip: the reel it came from, the route, and the day-by-day. */
export function TripScreen() {
  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <B4Header />

      <main className="mx-auto grid max-w-[1240px] grid-cols-1 items-start gap-10 px-4 pb-16 pt-[84px] md:grid-cols-[300px_1fr] md:px-10 md:pt-[116px] lg:grid-cols-[300px_1fr_300px]">
        {/* Reel + stats */}
        <aside className="flex flex-col gap-3.5 md:sticky md:top-[100px]">
          <div className="relative mx-auto aspect-[9/16] w-[260px] overflow-hidden rounded-[22px] bg-[#0D2436] shadow-[0_20px_46px_rgba(13,36,54,.2)] md:w-full">
            <Image src={A("goa-hero-beach-9x16.webp")} alt="The creator's Goa reel" fill priority sizes="300px" className="object-cover" />
            <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">Instagram · 0:42</span>
            <span className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90">
              <Play size={26} />
            </span>
          </div>
          <div className={`${CARD} mx-auto flex w-[260px] justify-between px-4 py-3 md:w-full`}>
            {STATS.map(([v, k]) => (
              <span key={k} className="flex flex-col">
                <strong className="num text-[18px]">{v}</strong>
                <span className="text-[11.5px] text-[#566E85]">{k}</span>
              </span>
            ))}
          </div>
        </aside>

        {/* Trip */}
        <section className="flex flex-col gap-[22px]">
          <div className="flex flex-col gap-3">
            <Kicker teal>CREATOR TRIP · GOA · 5 DAYS</Kicker>
            <h1 className="font-display m-0 text-[36px] font-medium leading-[1.08] md:text-[50px]">
              Slow North Goa: shacks, forts &amp; fish thalis
            </h1>
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 place-items-center rounded-full bg-[#0E3550] text-[13px] font-bold text-white">AR</span>
              <span className="flex flex-col">
                <strong className="text-[15px]">Ananya Rao <span className="font-normal text-[#566E85]">@ananyawanders</span></strong>
                <span className="text-[13px] text-[#566E85]">Went in Dec 2025 · travels slow, eats well</span>
              </span>
            </div>
          </div>

          {/* Route */}
          <div className="flex flex-col gap-2.5">
            <Kicker>THE ROUTE</Kicker>
            <div className={`${CARD} flex items-center justify-between gap-1 overflow-x-auto p-4`}>
              {ROUTE.map((stop, i) => (
                <span key={stop} className="flex items-center gap-1">
                  <span className="flex flex-col items-center gap-1.5">
                    <span className="grid size-7 place-items-center rounded-full border-[1.5px] border-[#0A7C80] text-[12px] font-bold text-[#0A7C80]">{i + 1}</span>
                    <span className="whitespace-nowrap text-[12.5px] font-medium">{stop}</span>
                  </span>
                  {i < ROUTE.length - 1 && <span className="mx-1 h-px w-8 flex-none bg-[#CFE3E4] md:w-12" />}
                </span>
              ))}
            </div>
          </div>

          {/* Day by day */}
          <div className="flex flex-col gap-2.5">
            <Kicker>DAY BY DAY</Kicker>
            {DAYS.map((d) => (
              <div key={d.n} className={`${CARD} flex items-start gap-3.5 p-3.5`}>
                <Image src={d.img} alt="" width={96} height={96} className="size-[88px] flex-none rounded-[14px] object-cover" />
                <span className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-bold tracking-[.1em] text-[#0A7C80]">DAY {d.n} · {d.place}</span>
                  <strong className="font-display text-[19px] font-medium leading-tight">{d.title}</strong>
                  <span className="text-[13.5px] text-[#566E85]">{d.body}</span>
                  <span className="text-[12.5px] font-semibold text-[#8A7F72]">▶ In the reel at {d.t}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Make it yours */}
        <aside className="md:col-span-2 lg:sticky lg:top-[100px] lg:col-span-1">
          <div className="flex flex-col gap-3 rounded-[22px] bg-[#072338] p-5 text-white">
            <Kicker className="text-[#6BEDEF]!">THIS TRIP</Kicker>
            <strong className="font-display text-[26px] font-medium leading-tight">Make it yours</strong>
            <p className="m-0 text-[14px] leading-normal text-[#A9C2D4]">
              Plan it around your dates, pace and who&rsquo;s coming. Flights, stays and transfers come together — you see the all-in price before you book.
            </p>
            <Link href={planThis} className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline">
              Plan this trip →
            </Link>
            <span className="text-center text-[12px] text-[#8DA7BC]">When you book, Ananya earns her share.</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
