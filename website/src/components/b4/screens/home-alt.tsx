"use client";

import Image from "next/image";
import Link from "next/link";

import { DESTINATIONS, LINKS } from "../data";
import { B4Header } from "../header";
import { CARD, Kicker } from "../flow";

const STEPS = [
  ["Tell us, or paste a reel", "A sentence or a saved reel is enough to start."],
  ["Arya builds the board", "Flights, stays and things to do — a real day-by-day."],
  ["Book it in one go", "One checkout, one all-in price. Change anything first."],
];

/** Home, editorial variant: a calm serif hero, three steps, and a destinations grid. */
export function HomeAltScreen() {
  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <B4Header />

      <section className="mx-auto max-w-[900px] px-4 pb-10 pt-[108px] text-center md:pt-[150px]">
        <Kicker teal className="block">PLAN LESS · TRAVEL MORE</Kicker>
        <h1 className="font-display mx-auto mt-3 max-w-[760px] text-[44px] font-medium leading-[1.05] md:text-[68px]">
          One chat. Your whole trip, made yours.
        </h1>
        <p className="mx-auto mt-4 max-w-[560px] text-[16px] leading-[1.6] text-[#3F5A72] md:text-[18px]">
          wishtrip turns what you&rsquo;ve saved and said into a trip you can book — flights, stays and the good bits, all in one place.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={LINKS.start} className="rounded-full bg-[#072338] px-7 py-4 text-base font-bold text-white no-underline">Start planning</Link>
          <Link href={LINKS.reel} className="rounded-full border-[1.5px] border-[#072338] px-7 py-4 text-base font-semibold text-[#072338] no-underline">Paste a reel</Link>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 pb-12 md:px-10">
        <div className="grid gap-3 md:grid-cols-3">
          {STEPS.map(([t, b], n) => (
            <div key={t} className={`${CARD} flex flex-col gap-2 p-5`}>
              <span className="font-display text-[28px] font-medium text-[#22C9CE]">{n + 1}</span>
              <strong className="text-[16px]">{t}</strong>
              <span className="text-[14px] leading-normal text-[#566E85]">{b}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-20 md:px-10">
        <Kicker teal>WHERE PEOPLE ARE GOING</Kicker>
        <h2 className="font-display mb-6 mt-2 text-[30px] font-medium leading-tight md:text-[40px]">Destinations we know well</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {DESTINATIONS.map((d) => (
            <Link key={d.name} href={LINKS.destination} className="group relative block aspect-[3/4] overflow-hidden rounded-[18px] no-underline">
              <Image src={d.img} alt={d.alt} fill sizes="240px" className="object-cover transition-transform group-hover:scale-105" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
              <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3 text-white">
                <span className="text-[10.5px] font-bold tracking-[.12em] text-[#9FB8CC]">{d.region}</span>
                <strong className="font-display text-[20px] font-medium">{d.name}</strong>
                <span className="text-[12px] text-[#C9DAE6]">{d.trips} trips planned</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
