"use client";

import Image from "next/image";
import Link from "next/link";

import { LINKS } from "../data";
import { B4Header } from "../header";
import { CARD, Kicker } from "../flow";

const A = (f: string) => `/b4/${f}`;
const planGoa = `${LINKS.start}?prompt=${encodeURIComponent("Plan a trip to Goa.")}`;

const STATS = [
  ["BEST TIME", "Nov to Feb"],
  ["FLIGHT FROM BLR", "1 h 15 min"],
  ["TRIPS PLANNED", "1,240"],
];

const REGIONS = [
  { name: "North Goa", img: A("goa-stay-north-anjuna.webp"), body: "Forts, markets, shacks and nightlife. Anjuna, Assagao, Morjim.", tag: "Best for friends and first trips" },
  { name: "South Goa", img: A("goa-stay-south-palolem.webp"), body: "Quiet beaches and palm-lined roads. Palolem, Agonda, Cola.", tag: "Best for couples and calm" },
];

const REELS = [
  { img: A("goa-beach-sunset-9x16.webp"), title: "Slow North Goa in 3 days", handle: "@goadiaries" },
  { img: A("goa-aguada-fort-9x16.webp"), title: "Forts, cafes and sunsets", handle: "@coastalkind" },
  { img: A("goa-village-lane-9x16.webp"), title: "Fontainhas on foot", handle: "@panjimwalks" },
  { img: A("goa-day5-morjim-shore.webp"), title: "Quiet beaches up north", handle: "@sandandslow" },
];

const BOOKED = [
  { img: A("goa-village-aerial-16x9.webp"), who: "Asha & family", trip: "5 days, North Goa, relaxed" },
  { img: A("goa-day1-calangute-umbrellas.webp"), who: "Vikram & friends", trip: "A long weekend in Anjuna" },
];

const TIPS = [
  ["Getting around", "Book a car with a driver. Taxis are scarce and app cabs are limited."],
  ["Where to stay", "Assagao or Siolim for quiet villas; Candolim for walking to the beach."],
  ["With parents", "Pick ground-floor rooms and keep drives under 30 minutes."],
  ["Food", "Try a fish thali at lunch; shacks close early in the off-season."],
];

/** A destination showcase (Goa): the place, how to split it, creator reels, and local tips. */
export function DestinationScreen() {
  return (
    <div className="min-h-dvh bg-[#FFFFFF]">
      <B4Header />

      {/* Hero */}
      <section className="relative h-[460px] md:h-[560px]">
        <Image src={A("goa-hero-beach-16x9.webp")} alt="Goa coastline from above" fill priority sizes="100vw" className="object-cover" />
        <span className="absolute inset-0 bg-gradient-to-t from-[rgba(7,35,56,.85)] via-[rgba(7,35,56,.25)] to-[rgba(7,35,56,.35)]" />
        <div className="absolute inset-x-0 bottom-0 mx-auto flex max-w-[1240px] flex-col gap-4 px-4 pb-10 text-white md:px-10 md:pb-14">
          <Kicker className="text-[#6BEDEF]!">INDIA › DESTINATION</Kicker>
          <h1 className="font-display m-0 text-[52px] font-medium leading-none md:text-[80px]">Goa</h1>
          <p className="m-0 max-w-[520px] text-[15.5px] leading-[1.5] text-[#E4EDF4] md:text-[17px]">
            Beaches, Portuguese forts and long fish-thali lunches. North for energy, South for quiet.
          </p>
          <div className="flex flex-wrap gap-x-9 gap-y-3">
            {STATS.map(([k, v]) => (
              <span key={k} className="flex flex-col">
                <span className="text-[11px] font-bold tracking-[.14em] text-[#9FB8CC]">{k}</span>
                <strong className="text-[17px]">{v}</strong>
              </span>
            ))}
          </div>
          <Link href={planGoa} className="mt-1 w-fit rounded-full bg-[#22DDE0] px-7 py-3.5 text-base font-bold text-[#072338] no-underline">
            Start planning a Goa trip →
          </Link>
        </div>
      </section>

      {/* Pick your Goa */}
      <section className="mx-auto max-w-[1240px] px-4 py-12 md:px-10 md:py-16">
        <Kicker teal>NORTH OR SOUTH?</Kicker>
        <h2 className="font-display mb-0 mt-2 text-[30px] font-medium leading-tight md:text-[40px]">Pick your Goa</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {REGIONS.map((r) => (
            <Link key={r.name} href={planGoa} className={`${CARD} flex items-stretch gap-0 overflow-hidden text-[#0D2436] no-underline`}>
              <Image src={r.img} alt="" width={140} height={160} className="h-auto w-[130px] flex-none object-cover md:w-[150px]" />
              <span className="flex flex-col gap-1.5 p-4">
                <strong className="font-display text-[20px] font-medium">{r.name}</strong>
                <span className="text-[13.5px] leading-normal text-[#566E85]">{r.body}</span>
                <span className="mt-0.5 text-[12.5px] font-bold text-[#0B7A57]">{r.tag}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Creator reels */}
      <section className="mx-auto max-w-[1240px] px-4 pb-12 md:px-10 md:pb-16">
        <Kicker teal>CREATOR TRIPS IN GOA</Kicker>
        <h2 className="font-display mb-0 mt-2 text-[30px] font-medium leading-tight md:text-[40px]">Trips that started as a reel</h2>
        <div className="rail mt-6 flex gap-3.5 overflow-x-auto pb-2">
          {REELS.map((r) => (
            <Link key={r.title} href={LINKS.reel} className="group relative block aspect-[9/16] w-[180px] flex-none overflow-hidden rounded-[18px] bg-[#0D2436] no-underline md:w-[210px]">
              <Image src={r.img} alt="" fill sizes="210px" className="object-cover transition-transform group-hover:scale-105" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
              <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3.5 text-white">
                <strong className="text-[15px] leading-tight">{r.title}</strong>
                <span className="text-[12px] text-[#C9DAE6]">{r.handle}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Booked by travellers */}
      <section className="mx-auto max-w-[1240px] px-4 pb-12 md:px-10 md:pb-16">
        <Kicker teal>REAL TRIPS, REAL TRAVELLERS</Kicker>
        <h2 className="font-display mb-0 mt-2 text-[30px] font-medium leading-tight md:text-[40px]">Booked by travellers like you</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {BOOKED.map((t) => (
            <div key={t.who} className={`${CARD} overflow-hidden`}>
              <div className="relative h-[180px]">
                <Image src={t.img} alt="" fill sizes="(max-width:640px) 100vw, 600px" className="object-cover" />
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-[#0B7A57]">Booked on wishtrip</span>
              </div>
              <div className="flex items-center justify-between gap-3 p-4">
                <span className="flex flex-col">
                  <strong className="text-[15px]">{t.who}</strong>
                  <span className="text-[13px] text-[#566E85]">{t.trip}</span>
                </span>
                <Link href={planGoa} className="whitespace-nowrap text-[13.5px] font-bold text-[#0A7C80]">Make it mine →</Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Local tips */}
      <section className="mx-auto max-w-[1240px] px-4 pb-16 md:px-10 md:pb-24">
        <Kicker teal>GOOD TO KNOW</Kicker>
        <h2 className="font-display mb-0 mt-2 text-[30px] font-medium leading-tight md:text-[40px]">Local tips from our trip experts</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIPS.map(([t, body]) => (
            <div key={t} className={`${CARD} flex flex-col gap-1.5 p-4`}>
              <strong className="text-[15px]">{t}</strong>
              <span className="text-[13.5px] leading-normal text-[#566E85]">{body}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
