"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, MobileBar, SELECTED, UNSELECTED } from "../flow";
import { GROUPS, PACES, PEOPLE } from "../flow-data";
import { Path } from "../icons";
import { useReelImport } from "../trip-journey";

type Count = "adults" | "kids" | "seniors";
const FIELD =
  "rounded-xl border-[1.5px] border-[#E3E8EE] bg-white px-3.5 py-[13px] text-[15.5px] font-medium tracking-normal text-[#0D2436] outline-none focus:border-[#0A7C80]";
const LABEL = "flex flex-col gap-2 text-[10.5px] font-bold tracking-[.14em] text-[#5F6B78]";

/** Step 2a: who's coming, when, how many days and pace — from the reel you just imported. */
export function DetailsScreen() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const imp = useReelImport(id);
  const content = imp.data?.content;
  const where = content?.destination_name || "your trip";

  const [group, setGroup] = useState("couple");
  const [count, setCount] = useState<Record<Count, number>>({ adults: 2, kids: 0, seniors: 0 });
  const [days, setDays] = useState<number>(content?.days_hint ?? 4);
  const [pace, setPace] = useState("relaxed");
  const n = count.adults + count.kids + count.seniors;
  const travellers = `${n} ${n === 1 ? "TRAVELLER" : "TRAVELLERS"}`;
  const bump = (k: Count, by: number) => setCount({ ...count, [k]: Math.max(0, Math.min(9, count[k] + by)) });

  const next = () => router.push(`${LINKS.board}?id=${id}&days=${days}`);

  const starting = content && (
    <div className={`${CARD} flex flex-col gap-2 p-4`}>
      <Kicker>FROM YOUR REEL</Kicker>
      <strong className="text-[15px]">
        {content.places.length} {content.places.length === 1 ? "place" : "places"} in {where}
      </strong>
      <span className="text-[12.5px] leading-normal text-[#566E85]">
        {content.places.filter((p) => p.kind !== "area").map((p) => p.location_name ?? p.name).slice(0, 6).join(" · ")}
      </span>
    </div>
  );

  const form = (
    <div className={`${CARD} flex flex-col gap-[22px] rounded-3xl p-4 md:p-[26px]`}>
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[10.5px] font-bold tracking-[.14em] text-[#5F6B78]">WHO’S COMING</legend>
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
        <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-3">
          {PEOPLE.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-2 rounded-[14px] border border-[#E3E8EE] bg-white py-1.5 pl-3.5 pr-1.5">
              <span className="flex flex-col">
                <strong className="text-sm font-semibold">{p.label}</strong>
                <span className="text-xs text-[#566E85]">{p.hint}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <button type="button" aria-label={`Fewer ${p.label}`} onClick={() => bump(p.key, -1)} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">−</button>
                <span className="min-w-[18px] text-center font-bold tabular-nums">{count[p.key]}</span>
                <button type="button" aria-label={`More ${p.label}`} onClick={() => bump(p.key, 1)} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">+</button>
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className={LABEL}>
          WHEN
          <input defaultValue="Add your dates" className={FIELD} />
        </label>
        <div className={LABEL}>
          HOW MANY DAYS
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Fewer days" onClick={() => setDays((d) => Math.max(1, d - 1))} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">−</button>
            <span className="min-w-[70px] rounded-xl border-[1.5px] border-[#E3E8EE] bg-white py-[11px] text-center text-[15.5px] font-semibold">{days} days</span>
            <button type="button" aria-label="More days" onClick={() => setDays((d) => Math.min(7, d + 1))} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">+</button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[10.5px] font-bold tracking-[.14em] text-[#5F6B78]">PACE</span>
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
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#FFFFFF]">
      <FlowHeader step={2} title={`Your ${where} trip`} subtitle="Your details" back={LINKS.reel} signedIn />
      {imp.isLoading ? (
        <p className="p-10 text-center text-[#566E85]">Loading your reel…</p>
      ) : !content ? (
        <p className="p-10 text-center text-[#566E85]">We couldn’t find that trip. <Link href={LINKS.reel} className="font-semibold text-[#0A7C80] underline">Start from a reel</Link>.</p>
      ) : (
        <>
          {/* Phones */}
          <div className="md:hidden">
            <section className="px-4 pb-1.5 pt-3.5">{starting}</section>
            <section className="px-4 pb-[150px] pt-2.5">{form}</section>
            <MobileBar>
              <span className="flex flex-col gap-0.5">
                <span className="text-[10.5px] font-bold tracking-[.14em] text-[#A9C2D4]">{days} DAYS · {travellers}</span>
                <span className="text-xs text-[#A9C2D4]">Your board shows the day-by-day.</span>
              </span>
              <button onClick={next} className="ml-auto whitespace-nowrap rounded-full bg-[#22DDE0] px-[18px] py-[13px] text-[15px] font-bold text-[#072338]">
                Build my board
              </button>
            </MobileBar>
          </div>

          {/* Desktop */}
          <main className="mx-auto hidden max-w-[1240px] grid-cols-[1fr_360px] items-start gap-9 px-10 pb-[72px] pt-10 md:grid">
            <section className="flex flex-col gap-[18px]">
              <div>
                <Kicker teal>YOUR DETAILS</Kicker>
                <h1 className="font-display mb-0 mt-1.5 text-[46px] font-medium leading-[1.08]">Your {where} trip</h1>
                <p className="mb-0 mt-2 text-[15.5px] text-[#3F5A72]">A few quick things, then your board builds itself from the reel.</p>
              </div>
              {form}
            </section>
            <aside className="sticky top-[100px] flex flex-col gap-3.5">
              {starting}
              <button onClick={next} className="rounded-full bg-[#072338] p-[15px] text-center text-base font-bold text-white">
                Build my board →
              </button>
              <span className="text-center text-xs text-[#5F6B78]">{days} days · {travellers.toLowerCase()}</span>
            </aside>
          </main>
        </>
      )}
    </div>
  );
}
