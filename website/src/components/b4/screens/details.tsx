"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, MobileBar, SELECTED, UNSELECTED } from "../flow";
import { BUDGETS, GROUPS, PACES, PEOPLE, PER_PERSON, STARTING_POINT, inr } from "../flow-data";
import { AryaMark, Path } from "../icons";

type Count = "adults" | "kids" | "seniors";

const FIELD = "rounded-xl border-[1.5px] border-[#E3DCD2] bg-white px-3.5 py-[13px] text-[15.5px] font-medium tracking-normal text-[#0D2436] outline-none focus:border-[#0A7C80]";
const LABEL = "flex flex-col gap-2 text-[10.5px] font-bold tracking-[.14em] text-[#8A7F72]";

function StartingPoint() {
  return (
    <div className={`${CARD} flex items-center gap-3 p-3.5`}>
      <Image src={STARTING_POINT.img} alt="" width={56} height={76} className="h-[76px] w-14 rounded-xl object-cover" />
      <span className="flex flex-col gap-[3px]">
        <Kicker>YOUR STARTING POINT</Kicker>
        <strong className="text-[15px]">{STARTING_POINT.title}</strong>
        <span className="text-[12.5px] text-[#566E85]">{STARTING_POINT.list}</span>
      </span>
    </div>
  );
}

/** Step 2a: who's coming, when, pace and budget. The estimate follows the traveller count. */
export function DetailsScreen() {
  const [group, setGroup] = useState<string>("family");
  const [count, setCount] = useState<Record<Count, number>>({ adults: 2, kids: 0, seniors: 1 });
  const [pace, setPace] = useState<string>("relaxed");
  const [budget, setBudget] = useState<string>("b2");

  const n = count.adults + count.kids + count.seniors;
  const estimate = inr(PER_PERSON.adults * count.adults + PER_PERSON.kids * count.kids + PER_PERSON.seniors * count.seniors);
  const travellers = `${n} ${n === 1 ? "TRAVELLER" : "TRAVELLERS"}`;
  const bump = (key: Count, by: number) => setCount({ ...count, [key]: Math.max(0, Math.min(9, count[key] + by)) });

  const form = (
    <div className={`${CARD} flex flex-col gap-[22px] rounded-3xl p-4 md:p-[26px]`}>
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[10.5px] font-bold tracking-[.14em] text-[#8A7F72]">WHO’S COMING</legend>
        <div role="radiogroup" aria-label="Who’s coming" className="grid grid-cols-5 gap-1.5 md:gap-2.5">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={group === g.id}
              onClick={() => {
                setGroup(g.id);
                setCount({ adults: g.c[0], kids: g.c[1], seniors: g.c[2] });
              }}
              className={`flex min-h-24 cursor-pointer flex-col items-center gap-1.5 rounded-2xl bg-white px-0.5 py-2.5 text-center text-[#0D2436] md:min-h-[126px] md:px-2 md:py-3.5 ${group === g.id ? SELECTED : UNSELECTED}`}
            >
              <span aria-hidden="true" className="grid size-[42px] place-items-center rounded-full md:size-[54px]" style={{ background: g.tint }}>
                <Path d={g.icon} size={22} stroke={g.col} width={1.8} />
              </span>
              <span className="text-[12.5px] font-semibold md:text-[14.5px]">{g.label}</span>
              <span className="hidden text-xs text-[#566E85] md:block">{g.hint}</span>
            </button>
          ))}
        </div>
        <span className="mt-1 text-[12.5px] text-[#566E85]">Fine-tune the exact count</span>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {PEOPLE.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-2 rounded-[14px] border border-[#E8E1D8] bg-white py-1.5 pl-3.5 pr-1.5">
              <span className="flex flex-col">
                <strong className="text-sm font-semibold">{p.label}</strong>
                <span className="text-xs text-[#566E85]">{p.hint}</span>
              </span>
              <span className="flex items-center gap-1.5">
                {(
                  [
                    [-1, "−", `Fewer ${p.label.toLowerCase()}`],
                    [1, "+", `More ${p.label.toLowerCase()}`],
                  ] as const
                ).map(([by, sign, label], i) => (
                  <span key={sign} className="contents">
                    {i === 1 && <span className="min-w-[18px] text-center font-bold tabular-nums">{count[p.key]}</span>}
                    <button
                      type="button"
                      aria-label={label}
                      onClick={() => bump(p.key, by)}
                      className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3DCD2] bg-white text-lg text-[#0D2436]"
                    >
                      {sign}
                    </button>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className={LABEL}>
          WHEN
          <input defaultValue="Thu 12 Dec → Mon 16 Dec" className={FIELD} />
        </label>
        <label className={LABEL}>
          FLYING FROM
          <input defaultValue="Bengaluru (BLR)" className={FIELD} />
        </label>
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="text-[10.5px] font-bold tracking-[.14em] text-[#8A7F72]">PACE</span>
        <div role="radiogroup" aria-label="Pace" className="grid grid-cols-3 gap-2">
          {PACES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={pace === p.id}
              onClick={() => setPace(p.id)}
              className={`min-h-[54px] cursor-pointer rounded-[14px] bg-white px-3.5 py-[11px] text-left text-[#0D2436] ${pace === p.id ? SELECTED : UNSELECTED}`}
            >
              <span className="block text-sm font-semibold">{p.label}</span>
              <span className="mt-0.5 block text-xs text-[#566E85]">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="text-[10.5px] font-bold tracking-[.14em] text-[#8A7F72]">BUDGET, ALL-IN</span>
        <div role="radiogroup" aria-label="Budget" className="flex flex-wrap gap-2">
          {BUDGETS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={budget === b.id}
              onClick={() => setBudget(b.id)}
              className={`min-h-11 cursor-pointer rounded-full border-[1.5px] px-4 py-2.5 text-[13.5px] font-semibold ${
                budget === b.id ? "border-[#072338] bg-[#072338] text-white" : "border-[#E3DCD2] bg-white text-[#3F5A72]"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <label className={LABEL}>
        ANYTHING WE SHOULD KNOW? (OPTIONAL)
        <textarea rows={2} defaultValue="Mum can’t do long walks or steep climbs. We love seafood." className={`${FIELD} resize-none font-normal!`} />
      </label>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader step={2} title="Asha’s Goa trip" subtitle="Your details · signed in as Asha" back={LINKS.reel} signedIn />

      {/* Phones */}
      <div className="md:hidden">
        <section className="px-4 pb-1.5 pt-3.5">
          <StartingPoint />
        </section>
        <section className="px-4 pb-[200px] pt-2.5">
          {form}
          <Link href={LINKS.arya} className="mt-3.5 block text-center text-sm font-semibold text-[#0A7C80] underline">
            Rather just tell Arya? She’ll fill this in
          </Link>
        </section>
        <MobileBar>
          <span className="flex flex-col gap-0.5">
            <span className="text-[10.5px] font-bold tracking-[.14em] text-[#A9C2D4]">ESTIMATE FOR {travellers}</span>
            <strong className="num text-2xl">{estimate}</strong>
            <span className="text-xs text-[#A9C2D4]">All-in from Bengaluru. Your board shows the final price.</span>
          </span>
          <Link href={LINKS.board} className="ml-auto whitespace-nowrap rounded-full bg-[#22DDE0] px-[18px] py-[13px] text-[15px] font-bold text-[#072338] no-underline">
            Build my trip
          </Link>
        </MobileBar>
      </div>

      {/* Desktop */}
      <main className="mx-auto hidden max-w-[1240px] grid-cols-[1fr_380px] items-start gap-9 px-10 pb-[72px] pt-10 md:grid">
        <section className="flex flex-col gap-[18px]">
          <div>
            <Kicker teal>YOUR DETAILS</Kicker>
            <h1 className="font-display mb-0 mt-1.5 text-[46px] font-medium leading-[1.08]">Asha’s Goa trip</h1>
            <p className="mb-0 mt-2 text-[15.5px] text-[#3F5A72]">Signed in as Asha Sharma, the lead traveller. A few quick things, then your board builds itself.</p>
          </div>
          {form}
        </section>
        <aside className="sticky top-[100px] flex flex-col gap-3.5">
          <StartingPoint />
          <div className="flex flex-col gap-4 rounded-[22px] bg-[#072338] p-[22px] text-white">
            <span className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-bold tracking-[.14em] text-[#A9C2D4]">ESTIMATE FOR {travellers}</span>
              <strong className="num text-[32px]">{estimate}</strong>
              <span className="text-xs text-[#A9C2D4]">All-in from Bengaluru. Your board shows the final price.</span>
            </span>
            <Link href={LINKS.board} className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline">
              Build my trip →
            </Link>
          </div>
          <Link href={LINKS.arya} className={`${CARD} flex items-center gap-3 px-4 py-3.5 text-[#0D2436] no-underline`}>
            <AryaMark size={38} fontSize={20} />
            <span className="flex flex-col">
              <strong className="text-[14.5px]">Rather just tell Arya?</strong>
              <span className="text-[12.5px] text-[#566E85]">Say it in a sentence. She fills this in for you.</span>
            </span>
          </Link>
        </aside>
      </main>
    </div>
  );
}
