"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, MobileBar, Why } from "../flow";
import { BOARD_FIXED, STAYS, boardDays, inr, type BoardItem, type StayId } from "../flow-data";
import { AryaMark, Path } from "../icons";

const PLANE = "M2 16l20-6-20-6 4 6-4 6zM6 10h8";
const CLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2";

function Stop({ it }: { it: BoardItem }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-[#E8E1D8] bg-white p-2.5">
      {it.img ? (
        <Image src={it.img} alt="" width={44} height={44} className="size-11 flex-none rounded-[10px] object-cover" />
      ) : (
        <span aria-hidden="true" className="grid size-11 flex-none place-items-center rounded-[10px] bg-[#F4EFE8]">
          <Path d={it.flight ? PLANE : CLOCK} size={19} stroke="#3F5A72" width={1.8} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-[11.5px] font-semibold text-[#8A7F72]">{it.t}</span>
        <strong className="text-[13.5px] leading-[1.3]">{it.name}</strong>
        <span className="self-start">
          <Why>{it.why}</Why>
        </span>
      </span>
    </div>
  );
}

/** Step 2b: the trip board — bookings, day by day, one all-in price. */
export function BoardScreen() {
  const [stayId, setStayId] = useState<StayId>("villa");
  const [dayN, setDayN] = useState(1);
  const stay = STAYS.find((s) => s.id === stayId)!;
  const other = STAYS.find((s) => s.id !== stayId)!;
  const diff = other.amt - stay.amt;
  const days = boardDays(stay);
  const day = days.find((d) => d.n === dayN)!;
  const total = inr(BOARD_FIXED.flights + stay.amt + BOARD_FIXED.experiences + BOARD_FIXED.transfers + BOARD_FIXED.taxes);

  const books = [
    { k: "FLIGHTS", name: "BLR ⇄ GOI · IndiGo", meta: "12 Dec 8:10 am · 16 Dec 6:30 pm · 3 seats", v: "₹19,800", why: "Cheapest, seats together", swap: false },
    { k: "STAY", name: stay.name, meta: stay.meta, v: inr(stay.amt), why: "Ground floor for Mum", swap: true },
    { k: "TRANSFERS", name: "Private SUV, same driver", meta: "Airport both ways + 3 day trips", v: "₹3,200", why: "Short drives only", swap: false },
  ].map((b) => (
    <div key={b.k} className="flex w-[250px] flex-none flex-col gap-2 rounded-[18px] border border-[#E8E1D8] bg-white p-3.5 md:w-auto">
      <span className="flex items-center justify-between">
        <Kicker>{b.k}</Kicker>
        <strong className="num text-sm">{b.v}</strong>
      </span>
      <strong className="text-[15px]">{b.name}</strong>
      <span className="text-[12.5px] text-[#566E85]">{b.meta}</span>
      <span className="flex flex-col items-start gap-1.5">
        <Why>{b.why}</Why>
        {b.swap && (
          <button
            type="button"
            onClick={() => setStayId(other.id)}
            className="cursor-pointer border-0 bg-transparent p-0 text-left text-[12.5px] font-bold text-[#0A7C80] underline underline-offset-[3px]"
          >
            Swap for {other.name.split(" ")[0]} ({diff < 0 ? "−" : "+"}
            {inr(Math.abs(diff))})
          </button>
        )}
      </span>
    </div>
  ));

  const lines = [
    { k: "Flights · 3 seats", v: "₹19,800" },
    { k: "Stay · 4 nights", v: inr(stay.amt) },
    { k: "Experiences & meals", v: "₹5,400" },
    { k: "Transfers", v: "₹3,200" },
    { k: "Taxes & fees", v: "₹3,400" },
  ];

  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader step={2} title="Asha’s Goa trip" subtitle="12–16 Dec · 3 travellers · from BLR" back={LINKS.details} signedIn />

      {/* Phones */}
      <div className="pb-[150px] md:hidden">
        <section className="flex flex-col gap-2.5 pb-1.5 pt-3.5">
          <Kicker className="px-4">BOOKINGS ON YOUR BOARD</Kicker>
          <div className="rail flex gap-2.5 overflow-x-auto px-4">{books}</div>
        </section>
        <section className="flex flex-col gap-2.5 px-4 py-3.5">
          <Kicker>DAY BY DAY</Kicker>
          <div role="tablist" aria-label="Days" className="grid grid-cols-5 gap-1.5">
            {days.map((d) => (
              <button
                key={d.n}
                type="button"
                role="tab"
                aria-selected={dayN === d.n}
                onClick={() => setDayN(d.n)}
                className={`cursor-pointer rounded-xl border-[1.5px] px-0.5 py-2 text-center ${
                  dayN === d.n ? "border-[#072338] bg-[#072338] text-white" : "border-[#E3DCD2] bg-white text-[#3F5A72]"
                }`}
              >
                <span className="block text-[13px] font-bold">Day {d.n}</span>
                <span className="block text-[11px]">{d.date}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" className="flex flex-col gap-2 rounded-[20px] bg-[#F4EFE8] p-3">
            <strong className="font-display text-xl font-medium">{day.title}</strong>
            {day.items.map((it) => (
              <Stop key={it.name} it={it} />
            ))}
          </div>
          <Link href={LINKS.arya} className="p-1.5 text-center text-sm font-semibold text-[#0A7C80] underline">
            Want a change? Ask Arya in your words
          </Link>
        </section>
        <Link
          href={LINKS.arya}
          className="fixed bottom-[120px] right-3.5 z-40 inline-flex min-h-[58px] items-center gap-[11px] rounded-full bg-[#072338] py-[7px] pl-[7px] pr-5 text-white no-underline shadow-[0_0_0_5px_rgba(34,221,224,.28),0_16px_40px_rgba(7,35,56,.4)]"
        >
          <AryaMark size={44} fontSize={25} />
          <span className="flex flex-col">
            <strong className="text-[15px]">Ask Arya</strong>
            <span className="text-xs font-medium text-[#A9C2D4]">She can change anything for you</span>
          </span>
        </Link>
        <MobileBar>
          <span className="flex flex-col">
            <strong className="num text-[22px]">{total}</strong>
            <span className="text-xs text-[#A9C2D4]">for 3, all-in · one checkout</span>
          </span>
          <Link href={LINKS.checkout} className="ml-auto rounded-full bg-[#22DDE0] px-5 py-[13px] text-[15px] font-bold text-[#072338] no-underline">
            Book in one go
          </Link>
        </MobileBar>
      </div>

      {/* Desktop */}
      <main className="mx-auto hidden max-w-[1320px] grid-cols-[1fr_330px] items-start gap-7 px-10 pb-[72px] pt-8 md:grid">
        <section className="flex min-w-0 flex-col gap-[22px]">
          <div className="flex items-end justify-between gap-5">
            <div>
              <Kicker teal>YOUR TRIP BOARD</Kicker>
              <h1 className="font-display mb-0 mt-1.5 text-[44px] font-medium leading-[1.08]">Asha’s Goa trip</h1>
              <p className="mb-0 mt-1.5 text-[15px] text-[#566E85]">Thu 12 → Mon 16 Dec · You, Vikram and Mum · from Bengaluru · relaxed pace</p>
            </div>
            <a href="#" className="whitespace-nowrap rounded-full border-[1.5px] border-[#E3DCD2] bg-white px-4 py-2.5 text-sm font-semibold text-[#0D2436] no-underline">
              Share with family
            </a>
          </div>
          <div className="flex flex-col gap-2.5">
            <Kicker>BOOKINGS ON YOUR BOARD</Kicker>
            <div className="grid grid-cols-3 gap-3">{books}</div>
          </div>
          <div className="flex flex-col gap-2.5">
            <Kicker>DAY BY DAY</Kicker>
            <div className="grid auto-cols-[236px] grid-flow-col gap-2.5 overflow-x-auto pb-1.5">
              {days.map((d) => (
                <div key={d.n} className="flex min-w-0 flex-col gap-2 rounded-[20px] bg-[#F4EFE8] p-3">
                  <span className="flex flex-col gap-px px-1 pb-1.5 pt-0.5">
                    <span className="text-[11.5px] font-bold text-[#0A7C80]">
                      DAY {d.n} · {d.date}
                    </span>
                    <strong className="font-display text-lg font-medium leading-[1.2]">{d.title}</strong>
                  </span>
                  {d.items.map((it) => (
                    <Stop key={it.name} it={it} />
                  ))}
                </div>
              ))}
            </div>
            <span className="text-[12.5px] text-[#8A7F72]">Scroll sideways for all 5 days · drag a card to move it</span>
          </div>
        </section>
        <aside className="sticky top-[100px] flex flex-col gap-3.5">
          <div className={`${CARD} flex flex-col gap-2.5 rounded-[22px] p-5`}>
            <Kicker>ONE PRICE, EVERYTHING IN</Kicker>
            {lines.map((l) => (
              <span key={l.k} className="flex justify-between text-[13.5px] text-[#3F5A72]">
                <span>{l.k}</span>
                <span className="num font-semibold! text-[#0D2436]">{l.v}</span>
              </span>
            ))}
            <span className="mt-0.5 flex items-baseline justify-between border-t border-[#EDE6DC] pt-3">
              <strong className="text-[15px]">Total for 3</strong>
              <strong className="num text-[30px]">{total}</strong>
            </span>
            <Link
              href={LINKS.checkout}
              className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline shadow-[0_10px_26px_rgba(18,201,206,.3)]"
            >
              Book in one go
            </Link>
            <span className="text-center text-xs text-[#566E85]">Nothing is charged until you choose at checkout</span>
          </div>
          <div className={`${CARD} flex flex-col gap-2.5 rounded-[22px] p-4`}>
            <span className="flex items-center gap-2.5">
              <AryaMark size={34} fontSize={18} />
              <strong className="text-[15px]">Change anything with Arya</strong>
            </span>
            <span className="text-[13px] text-[#566E85]">Say it in your words. The board and the price update.</span>
            <span className="flex flex-wrap gap-1.5">
              {["Add a sunset cruise", "Make day 3 easier"].map((t) => (
                <Link key={t} href={LINKS.arya} className="rounded-full border-[1.5px] border-[#BDEFF0] px-[11px] py-[7px] text-[12.5px] font-semibold text-[#0A7C80] no-underline">
                  {t}
                </Link>
              ))}
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}
