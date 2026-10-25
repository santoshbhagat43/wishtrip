"use client";

import Link from "next/link";
import { useState } from "react";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, Why } from "../flow";
import { AryaMark, CHECK, Path } from "../icons";

const PHONE = "M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z";
const CLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2";

const GREETING = [
  { from: "arya", text: "Hi Asha — tell me who's coming and roughly when, and I'll start a board. I never book or pay without your OK." },
  { from: "me", text: "3 of us to Goa in December. My mum can't walk far. We love seafood." },
  { from: "arya", text: "Got it — a relaxed North Goa trip for 3, ground-floor stay, short drives, seafood lunches. Here's a first board." },
];

const BOARD_KNOWS = ["3 travellers · 1 needs step-free", "North Goa · 12–16 Dec", "Relaxed pace · loves seafood"];
const COMING = [
  { k: "STAY", v: "Assagao heritage villa", why: "Ground floor for Mum" },
  { k: "FLIGHTS", v: "BLR ⇄ GOI · seats together", why: "Cheapest with 3 seats" },
];
const DAYS = [
  { n: 1, title: "Arrive slow", items: "Check in · sunset at Fort Aguada" },
  { n: 2, title: "Beaches & a long lunch", items: "Fish thali · flat beach walk" },
];

/** Arya, the AI travel agent: a conversation on the left, your live board on the right. */
export function AryaScreen() {
  const [choice, setChoice] = useState<"book" | "hold" | "human" | null>(null);

  const bubbles = GREETING.map((m, i) => (
    <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "items-start gap-2"}`}>
      {m.from === "arya" && <AryaMark size={26} fontSize={14} />}
      <span
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-[1.45] ${
          m.from === "me" ? "bg-[#072338] text-white" : "bg-white text-[#0D2436] ring-1 ring-[#E3E8EE]"
        }`}
      >
        {m.text}
      </span>
    </div>
  ));

  return (
    <div className="min-h-dvh bg-[#FFFFFF]">
      <FlowHeader step={1} title="Plan with Arya" subtitle="Your AI travel agent" back={LINKS.home} signedIn />

      <main className="mx-auto grid max-w-[1240px] grid-cols-1 items-start gap-6 px-4 pb-10 pt-6 md:grid-cols-[1fr_380px] md:px-10 md:pt-8">
        {/* Conversation */}
        <section className="flex flex-col gap-3">
          <div className={`${CARD} flex items-center gap-3 p-4`}>
            <AryaMark size={40} fontSize={21} />
            <span className="flex flex-col">
              <strong className="text-[16px]">Arya</strong>
              <span className="text-[13px] text-[#566E85]">Your wishtrip AI travel agent · never pays without your OK</span>
            </span>
          </div>

          <div className="flex flex-col gap-2.5">{bubbles}</div>

          {/* Ready to book */}
          <div className="rounded-[20px] border-2 border-dashed border-[#BDEFF0] bg-[#F3FCFC] p-4">
            <div className="flex items-center justify-between">
              <Kicker teal>READY TO BOOK · NEEDS YOUR OK</Kicker>
            </div>
            <p className="mb-3 mt-1 text-[14px] text-[#3F5A72]">Everything on your board, booked together. You see the all-in price before anything is charged.</p>
            <div className="flex flex-col gap-2">
              {([
                ["book", "Book the trip", "Review and pay at checkout", CHECK],
                ["hold", "Hold it for 72 hours", "Lock the price, decide later", CLOCK],
                ["human", "Talk to a human advisor", "A trip expert calls you back within 10 minutes", PHONE],
              ] as const).map(([id, title, sub, icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setChoice(id)}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ${choice === id ? "border-2 border-[#0A7C80] shadow-[0_0_0_3px_#DCF8F9]" : "border-[1.5px] border-[#E3DCD2]"}`}
                >
                  <span className="grid size-9 flex-none place-items-center rounded-xl bg-[#E6F7F7]">
                    <Path d={icon} size={18} stroke="#0A7C80" width={1.9} />
                  </span>
                  <span className="flex flex-col">
                    <strong className="text-[14.5px]">{title}</strong>
                    <span className="text-[12.5px] text-[#566E85]">{sub}</span>
                  </span>
                </button>
              ))}
            </div>
            {choice && (
              <Link
                href={choice === "human" ? LINKS.board : LINKS.checkout}
                className="mt-3 block rounded-full bg-[#22DDE0] p-3.5 text-center text-[15px] font-bold text-[#072338] no-underline"
              >
                {choice === "book" ? "Go to checkout →" : choice === "hold" ? "Hold this trip →" : "Request a call back →"}
              </Link>
            )}
          </div>

          {/* Input */}
          <div className={`${CARD} flex items-center gap-2 rounded-full p-1.5`}>
            <input
              placeholder="Change anything — “make day 3 easier”, “add a sunset cruise”…"
              className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[14.5px] outline-none placeholder:text-[#8A93A0]"
            />
            <Link href={LINKS.start} aria-label="Send" className="grid size-10 flex-none place-items-center rounded-full bg-[#072338] text-white no-underline">
              →
            </Link>
          </div>
        </section>

        {/* Live board */}
        <aside className="flex flex-col gap-3.5 md:sticky md:top-[100px]">
          <div className={`${CARD} flex flex-col gap-3 rounded-[22px] p-5`}>
            <div className="flex items-center gap-2">
              <span className="text-xl">🗺️</span>
              <span className="flex flex-col">
                <strong className="font-display text-[20px] font-medium leading-tight">Asha&rsquo;s Goa trip</strong>
                <span className="text-[12.5px] text-[#566E85]">12–16 Dec · 3 travellers · from BLR</span>
              </span>
            </div>

            <div>
              <Kicker>WHAT ARYA KNOWS</Kicker>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {BOARD_KNOWS.map((k) => (
                  <span key={k} className="rounded-full bg-[#F1EAE0] px-2.5 py-1 text-[12px] font-medium text-[#3F5A72]">{k}</span>
                ))}
              </div>
            </div>

            <div>
              <Kicker>COMING UP ON YOUR BOARD</Kicker>
              <div className="mt-1.5 flex flex-col gap-2">
                {COMING.map((c) => (
                  <div key={c.k} className="rounded-[14px] border border-[#E3E8EE] bg-white p-2.5">
                    <span className="flex items-center justify-between">
                      <Kicker>{c.k}</Kicker>
                      <span className="rounded-full bg-[#FDF3E1] px-2 py-0.5 text-[10.5px] font-bold text-[#9A6412]">Just added</span>
                    </span>
                    <strong className="mt-0.5 block text-[14px]">{c.v}</strong>
                    <span className="mt-1 inline-block"><Why>{c.why}</Why></span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Kicker>DAY BY DAY</Kicker>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {DAYS.map((d) => (
                  <div key={d.n} className="rounded-[12px] bg-[#F3F6F9] px-3 py-2">
                    <span className="text-[11.5px] font-bold text-[#0A7C80]">DAY {d.n}</span>
                    <strong className="ml-2 text-[13.5px]">{d.title}</strong>
                    <span className="block text-[12.5px] text-[#566E85]">{d.items}</span>
                  </div>
                ))}
              </div>
            </div>

            <Link href={LINKS.board} className="rounded-full bg-[#072338] p-3.5 text-center text-[15px] font-bold text-white no-underline">
              See the full board →
            </Link>
            <span className="text-center text-xs text-[#566E85]">Nothing is charged until you choose at checkout.</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
