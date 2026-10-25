"use client";

import Image from "next/image";
import Link from "next/link";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, Why } from "../flow";
import { BOARD_FIXED, STAYS, boardDays, inr } from "../flow-data";
import { Path } from "../icons";

const PLANE = "M2 16l20-6-20-6 4 6-4 6zM6 10h8";

/** Board, take two: one vertical timeline down the page instead of day columns. */
export function Board2Screen() {
  const stay = STAYS[0];
  const days = boardDays(stay);
  const total = inr(BOARD_FIXED.flights + stay.amt + BOARD_FIXED.experiences + BOARD_FIXED.transfers + BOARD_FIXED.taxes);
  const lines = [
    ["Flights · 3 seats", "₹19,800"],
    [`Stay · 4 nights`, inr(stay.amt)],
    ["Experiences & meals", "₹5,400"],
    ["Transfers", "₹3,200"],
    ["Taxes & fees", "₹3,400"],
  ];

  return (
    <div className="min-h-dvh bg-[#FFFFFF]">
      <FlowHeader step={2} title="Asha’s Goa trip" subtitle="12–16 Dec · 3 travellers · timeline view" back={LINKS.details} signedIn />

      <main className="mx-auto grid max-w-[1100px] grid-cols-1 items-start gap-8 px-4 pb-16 pt-6 md:grid-cols-[1fr_320px] md:px-10 md:pt-8">
        {/* Timeline */}
        <section className="flex flex-col">
          <Kicker teal>YOUR TRIP, DAY BY DAY</Kicker>
          <h1 className="font-display mb-5 mt-1.5 text-[34px] font-medium leading-tight md:text-[44px]">Asha&rsquo;s Goa trip</h1>
          <div className="relative flex flex-col gap-6 border-l-2 border-[#E3DCD2] pl-6">
            {days.map((d) => (
              <div key={d.n} className="relative">
                <span className="absolute -left-[31px] grid size-6 place-items-center rounded-full bg-[#072338] text-[11px] font-bold text-white">{d.n}</span>
                <span className="text-[11.5px] font-bold tracking-[.1em] text-[#0A7C80]">DAY {d.n} · {d.date}</span>
                <h2 className="font-display mb-2 mt-0.5 text-[20px] font-medium">{d.title}</h2>
                <div className="flex flex-col gap-2">
                  {d.items.map((it) => (
                    <div key={it.name} className={`${CARD} flex items-center gap-3 p-2.5`}>
                      {it.img ? (
                        <Image src={it.img} alt="" width={44} height={44} className="size-11 flex-none rounded-[10px] object-cover" />
                      ) : (
                        <span className="grid size-11 flex-none place-items-center rounded-[10px] bg-[#F3F6F9]"><Path d={PLANE} size={18} stroke="#3F5A72" width={1.8} /></span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[11.5px] font-semibold text-[#5F6B78]">{it.t}</span>
                        <strong className="text-[14px] leading-tight">{it.name}</strong>
                        <span className="self-start"><Why>{it.why}</Why></span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Price */}
        <aside className="md:sticky md:top-[100px]">
          <div className={`${CARD} flex flex-col gap-2.5 rounded-[22px] p-5`}>
            <Kicker>ONE PRICE, EVERYTHING IN</Kicker>
            {lines.map(([k, v]) => (
              <span key={k} className="flex justify-between text-[13.5px] text-[#3F5A72]">
                <span>{k}</span><span className="num font-semibold! text-[#0D2436]">{v}</span>
              </span>
            ))}
            <span className="mt-0.5 flex items-baseline justify-between border-t border-[#E8EDF2] pt-3">
              <strong className="text-[15px]">Total for 3</strong><strong className="num text-[28px]">{total}</strong>
            </span>
            <Link href={LINKS.checkout} className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline">Book in one go</Link>
            <span className="text-center text-xs text-[#566E85]">Nothing is charged until checkout.</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
