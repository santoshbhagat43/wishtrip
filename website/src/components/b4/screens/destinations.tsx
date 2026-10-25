import Link from "next/link";

import type { DestinationCard } from "@/lib/server/destinations";

import { START_IDEAS } from "../data";
import { SiteFooter } from "../footer";
import { B4Header } from "../header";
import { DestinationGrid } from "./destination-grid";
import { describe, Photo, placesLabel, tripsLabel } from "./destination-parts";

const plan = (prompt: string) => `/arya?prompt=${encodeURIComponent(prompt)}`;

/** One tile of the hero mosaic. */
function Tile({ d, big = false }: { d: DestinationCard; big?: boolean }) {
  const line = describe(d);
  return (
    <Link
      href={`/explore/${d.id}`}
      className={`group relative block overflow-hidden rounded-[24px] bg-[#072338] text-white no-underline ${big ? "row-span-2" : ""}`}
    >
      <Photo d={d} className="transition duration-300 group-hover:scale-[1.03]" />
      <span className="absolute inset-0 bg-gradient-to-t from-[#072338]/85 via-[#072338]/10 to-[#072338]/20" />
      <span className="absolute left-3 top-3 rounded-full bg-white/20 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider backdrop-blur">
        {d.country ?? d.region}
      </span>
      <span className="absolute inset-x-4 bottom-4 flex flex-col gap-1">
        <strong className={`font-display font-medium leading-tight ${big ? "text-[44px]" : "text-[26px]"}`}>{d.name}</strong>
        {line && <span className={`${big ? "text-[14px]" : "line-clamp-2 text-[12.5px]"} text-white/90`}>{line}</span>}
        <span className="text-[12px] font-semibold text-white/90">
          {d.creator_trips > 0 ? tripsLabel(d.creator_trips) : placesLabel(d.place_count)}
        </span>
      </span>
    </Link>
  );
}

/** The Destinations page (/destinations): the places in WishTrip's checked knowledge, and which of
 *  them real creators have been to. Only what we hold: no prices, no stock photos. */
export function DestinationsScreen({ destinations }: { destinations: DestinationCard[] | null }) {
  const list = destinations ?? [];
  // The mosaic leads with the places creators have been to, then the best-covered ones.
  const lead = [...list].sort((a, b) => b.creator_trips - a.creator_trips || b.place_count - a.place_count).slice(0, 5);

  return (
    <div className="min-h-dvh bg-white text-[#0D2436]">
      <B4Header solid />

      <section className="bg-gradient-to-b from-[#EAFBFC] to-white px-4 pb-10 pt-[96px] md:px-10 md:pb-16 md:pt-[116px]">
        <div className="mx-auto grid max-w-[1240px] items-center gap-10 lg:grid-cols-[minmax(0,420px)_1fr]">
          <div className="flex flex-col gap-5">
            <p className="m-0 text-[12.5px] font-bold tracking-[.1em] text-[#0A7C80]">DESTINATIONS</p>
            <h1 className="font-display m-0 text-[48px] font-medium leading-[1.02] md:text-[64px]">
              Where to <em className="font-display block text-[#0A7C80]">next?</em>
            </h1>
            <p className="m-0 text-[16.5px] leading-relaxed text-[#3F5A72]">
              Every place here is in WishTrip&rsquo;s checked travel knowledge, and some already have trips from real travel
              creators. Pick one, make it yours with Arya.
            </p>
            <form action="/arya" method="get" className="flex items-center gap-2 rounded-full border border-[#E3E8EE] bg-white p-1.5 pl-5 shadow-[0_6px_24px_rgba(7,35,56,.08)]">
              <input
                name="prompt"
                aria-label="Ask Arya where to go"
                placeholder="Beach in December, under ₹60k…"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#8A93A0]"
              />
              <button type="submit" className="rounded-full bg-[#072338] px-5 py-3 text-[14.5px] font-semibold text-white">
                Ask Arya
              </button>
            </form>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {START_IDEAS.map((idea) => (
                <li key={idea}>
                  <Link href={plan(idea)} className="rounded-full border border-[#E3E8EE] bg-white px-3.5 py-2 text-[13px] font-medium text-[#0D2436] no-underline hover:bg-[#F3F6F9]">
                    {idea}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {lead.length >= 3 && (
            <div className="hidden h-[520px] grid-cols-3 grid-rows-2 gap-4 lg:grid">
              {lead.map((d, i) => (
                <Tile key={d.id} d={d} big={i === 0} />
              ))}
            </div>
          )}
        </div>
      </section>

      <main className="mx-auto max-w-[1240px] px-4 pb-6 md:px-10">
        <section className="mt-6 md:mt-10" aria-labelledby="every">
          <p className="m-0 text-[12.5px] font-bold tracking-[.1em] text-[#0A7C80]">EVERY DESTINATION</p>
          <h2 id="every" className="font-display m-0 mt-2 text-[32px] font-medium md:text-[44px]">
            Pick a place, see who&rsquo;s been
          </h2>
          {list.length > 0 ? (
            <DestinationGrid destinations={list} />
          ) : (
            <p className="mt-6 rounded-[22px] border border-[#E3E8EE] bg-[#F3F6F9] p-8 text-center text-[15px] text-[#566E85]">
              {destinations ? "No destinations are published yet." : "We couldn't load the destinations. Please try again in a moment."}
            </p>
          )}
        </section>
      </main>

      <section className="mt-12 bg-[#072338] px-4 py-12 text-white md:px-10 md:py-16">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div>
            <p className="m-0 text-[12.5px] font-bold tracking-[.12em] text-[#22DDE0]">CAN&rsquo;T DECIDE?</p>
            <h2 className="font-display m-0 mt-2 text-[30px] font-medium md:text-[42px]">Tell Arya the mood. She&rsquo;ll find the place.</h2>
            <p className="m-0 mt-2 text-[15px] text-white/75">&ldquo;Somewhere warm in December, good for a 4-year-old.&rdquo;</p>
          </div>
          <Link href="/arya" className="rounded-full bg-[#22DDE0] px-7 py-4 text-[16px] font-bold text-[#072338] no-underline">
            Start planning →
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-[1240px] px-4 pb-8 md:px-10">
        <SiteFooter />
      </div>
    </div>
  );
}
