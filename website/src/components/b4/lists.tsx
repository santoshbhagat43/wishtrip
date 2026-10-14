"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { LINKS, REEL_SORTS, REELS, TRAVELLER_TRIPS, TRIP_FILTERS, compact } from "./data";
import { CHECK, Path, Play } from "./icons";
import { Chips, SectionHead } from "./section-head";

type SortId = (typeof REEL_SORTS)[number]["id"];
type FilterId = (typeof TRIP_FILTERS)[number]["id"];

/** Creator trips: 9:16 cards, a rail on phones and a 4-up grid on desktop. */
export function CreatorReels() {
  const [sort, setSort] = useState<SortId>("booked");
  const reels = [...REELS].sort((a, b) => b[sort] - a[sort]);
  return (
    <section id="b4-reels" className="bg-[#FBF8F4] px-4 py-11 md:px-10 md:py-[104px]">
      <div className="mx-auto max-w-[1200px]">
        <SectionHead
          eyebrow="CREATOR TRIPS"
          title="Trips that started as a reel"
          lead="Instagram and YouTube creators, with how many people watched, saved and booked each trip."
          link={{ href: "#b4-reels", label: "See all 48 creator trips →" }}
        />
        <Chips label="Sort creator trips" options={REEL_SORTS} value={sort} onChange={setSort} />
        <div className="rail -mx-4 flex gap-2.5 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:gap-[18px] md:overflow-visible md:px-0">
          {reels.map((r) => (
            <Link
              key={r.title}
              href={LINKS.creatorTrip}
              className="relative block aspect-[9/16] w-[172px] flex-none overflow-hidden rounded-2xl bg-[#124A72] text-white no-underline md:w-auto md:rounded-[20px]"
            >
              <Image src={r.img} alt={r.alt} fill sizes="(min-width: 768px) 300px, 172px" className="object-cover" />
              {r.vid && (
                <video
                  src={r.vid}
                  poster={r.img}
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-hidden="true"
                  className="absolute inset-0 size-full object-cover motion-reduce:hidden"
                />
              )}
              <span
                className="absolute inset-0"
                style={{ background: "linear-gradient(180deg,rgba(6,28,46,.4) 0%,rgba(6,28,46,0) 22%,rgba(6,28,46,0) 40%,rgba(6,28,46,.94) 100%)" }}
              />
              <span className="absolute left-2.5 top-2.5 rounded-full bg-white/[.18] px-[9px] py-[3px] text-[10.5px] font-bold backdrop-blur-[8px]">{r.platform}</span>
              <span className="absolute inset-x-3 bottom-3 flex flex-col gap-[5px]">
                <strong className="font-display text-base font-medium leading-[1.2] md:text-[19px]">{r.title}</strong>
                <span className="text-[12.5px] text-[#C9DAE6]">{r.handle}</span>
                <span className="flex gap-2.5 text-[12.5px] text-[#E6F0F6]">
                  <span className="inline-flex items-center gap-1" aria-label={`${compact(r.views)} views`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {compact(r.views)}
                  </span>
                  <span className="inline-flex items-center gap-1" aria-label={`${compact(r.saves)} saves`}>
                    <Path d="M6 3h12v18l-6-4-6 4z" size={13} />
                    {compact(r.saves)}
                  </span>
                </span>
                <span className="self-start rounded-full bg-[#22DDE0] px-[9px] py-[3px] text-[11px] font-bold text-[#072338] md:text-xs">{r.booked} booked this trip</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Trips travellers booked: video card, route dots and the all-in price. */
export function TravellerTrips() {
  const [filter, setFilter] = useState<FilterId>("all");
  const trips = TRAVELLER_TRIPS.filter((t) => filter === "all" || t.type === filter);
  return (
    <section id="b4-travellers" className="bg-[#FBF8F4] px-4 py-11 md:px-10 md:py-[104px]">
      <div className="mx-auto max-w-[1200px]">
        <SectionHead
          eyebrow="REAL TRIPS, REAL TRAVELLERS"
          title="Booked by travellers like you"
          lead="Trips people booked through wishtrip, shared day by day for the next traveller. Start from one and make it yours."
        />
        <Chips label="Who travelled" options={TRIP_FILTERS} value={filter} onChange={setFilter} />
        <div className="rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 md:pb-0">
          {trips.map((t) => {
            const inset = `${(50 / t.route.length).toFixed(1)}%`;
            return (
              <Link
                key={t.who}
                href={LINKS.creatorTrip}
                className="flex w-[300px] flex-none flex-col overflow-hidden rounded-[18px] border border-[#DFE7EE] bg-white text-[#0D2436] no-underline shadow-[0_10px_30px_rgba(13,36,54,.06)] md:w-auto md:rounded-[22px]"
              >
                <span className="relative block aspect-[16/10] bg-[#124A72]">
                  <Image src={t.img} alt={t.alt} fill sizes="(min-width: 768px) 400px, 300px" className="object-cover" />
                  <span className="absolute inset-0" style={{ background: "linear-gradient(180deg,rgba(6,28,46,0) 50%,rgba(6,28,46,.7) 100%)" }} />
                  <span aria-hidden="true" className="absolute left-1/2 top-[45%] grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/[.92]">
                    <Play size={16} />
                  </span>
                  <span className="absolute bottom-2.5 left-3 text-[11.5px] font-semibold text-white">Trip film from their photos · {t.len}</span>
                  <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-[5px] rounded-full bg-[#E3F5EE] px-[9px] py-1 text-[11px] font-bold text-[#0B7A57]">
                    <Path d={CHECK} size={11} stroke="#0B7A57" width={3} />
                    Booked on wishtrip
                  </span>
                </span>
                <span className="flex flex-col gap-2.5 p-[18px]">
                  <span className="flex flex-col gap-0.5">
                    <strong className="text-[17px]">{t.who}</strong>
                    <span className="text-[13.5px] text-[#566E85]">{t.trip}</span>
                  </span>
                  <span
                    role="img"
                    aria-label={`Route: ${t.route.join(", ")}`}
                    className="relative grid pt-1"
                    style={{ gridTemplateColumns: `repeat(${t.route.length}, minmax(0, 1fr))` }}
                  >
                    <span aria-hidden="true" className="absolute top-[11px] h-0.5 bg-[#BDEFF0]" style={{ left: inset, right: inset }} />
                    {t.route.map((place, k) => (
                      <span key={`${place}-${k}`} className="relative flex flex-col items-center gap-1 text-center">
                        <span className="grid size-4 place-items-center rounded-full border-2 border-[#22DDE0] bg-white text-[8px] font-extrabold text-[#0A7C80]">{k + 1}</span>
                        <span className="text-[11.5px] leading-[1.2] text-[#3F5A72]">{place}</span>
                      </span>
                    ))}
                  </span>
                  <span className="flex items-center justify-between border-t border-[#E8EEF4] pt-2.5">
                    <span className="text-sm">
                      <strong>{t.price}</strong> <span className="text-[#566E85]">{t.priceFor}</span>
                    </span>
                    <span className="text-sm font-bold text-[#0A7C80]">Make it mine →</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
