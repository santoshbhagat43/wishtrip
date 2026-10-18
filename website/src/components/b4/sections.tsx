import Image from "next/image";
import Link from "next/link";

import { CREATOR_DASHBOARD, CREATOR_STEPS, DESTINATIONS, IMG, LINKS, TRUST } from "./data";
import { Path } from "./icons";
import { SectionHead } from "./section-head";
import { SiteFooter } from "./footer";

/** Destination tiles: Goa leads (full width on phones, a 2×2 block on desktop). */
export function Destinations() {
  return (
    <section id="b4-dest" className="bg-white px-4 py-11 md:px-10 md:py-[104px]">
      <div className="mx-auto max-w-[1200px]">
        <SectionHead
          eyebrow="KNOW WHERE YOU WANT TO GO?"
          title="Start with a destination"
          lead="Every creator trip, local tip and real itinerary for a place, on one page."
          link={{ href: LINKS.destinations, label: "All destinations →" }}
        />
        <div className="grid auto-rows-[150px] grid-cols-2 gap-2.5 md:auto-rows-[220px] md:grid-cols-4 md:gap-[18px]">
          {DESTINATIONS.map((d, i) => (
            <Link
              key={d.name}
              href={LINKS.destination}
              className={`relative block overflow-hidden rounded-[22px] bg-[#124A72] text-white no-underline ${i === 0 ? "col-span-2 md:row-span-2" : ""}`}
            >
              <Image src={d.img} alt={d.alt} fill sizes={i === 0 ? "(min-width: 768px) 600px, 100vw" : "(min-width: 768px) 300px, 50vw"} className="object-cover" />
              <span className="absolute inset-0" style={{ background: "linear-gradient(180deg,rgba(6,28,46,0) 35%,rgba(6,28,46,.88) 100%)" }} />
              <span className="absolute inset-x-3 bottom-3 flex flex-col gap-[3px] md:inset-x-[18px] md:bottom-4">
                <span className="text-[10px] font-bold tracking-[.14em] text-[#6BEDEF]">{d.region}</span>
                <strong className={`font-display font-medium ${i === 0 ? "text-[26px] md:text-[40px]" : "text-xl md:text-2xl"}`}>{d.name}</strong>
                <span className="text-[11.5px] text-[#C9DAE6] md:text-[13px]">
                  {d.trips} trips · from {d.price}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** For creators: how it works, and an example dashboard card. */
export function Creators() {
  return (
    <section id="b4-creators" aria-labelledby="b4-creators-h" className="bg-[#072338] px-4 py-11 text-white md:px-10 md:py-[104px]">
      <div className="mx-auto grid max-w-[1200px] items-center gap-[26px] md:grid-cols-[1.1fr_.9fr] md:gap-[72px]">
        <div className="flex flex-col gap-3.5 md:gap-[18px]">
          <span className="text-[11px] font-bold tracking-[.16em] text-[#6BEDEF] md:text-[12.5px]">FOR CREATORS · EARN WITH WISHTRIP</span>
          <h2 id="b4-creators-h" className="font-display m-0 text-[30px] font-medium leading-[1.1] tracking-[-0.015em] md:text-[46px]">
            Your trip becomes a source of earning
          </h2>
          <p className="m-0 max-w-[540px] text-[15px] leading-[1.55] text-[#C9DAE6] md:text-lg">
            Already posted your travels? Every time someone books your trip on wishtrip, you earn. Your reels keep working long after you’re home.
          </p>
          <ol className="m-0 mt-1 flex list-none flex-col gap-3.5 p-0 md:mt-2 md:gap-[18px]">
            {CREATOR_STEPS.map((step) => (
              <li key={step.title} className="flex items-start gap-3.5">
                <span className="grid size-11 flex-none place-items-center rounded-xl bg-[rgba(34,221,224,.14)]">
                  <Path d={step.icon} stroke="#6BEDEF" />
                </span>
                <span className="flex flex-col gap-[3px]">
                  <strong className="text-base text-white md:text-[17px]">{step.title}</strong>
                  <span className="text-sm leading-normal text-[#A9C2D4] md:text-[15px]">{step.desc}</span>
                </span>
              </li>
            ))}
          </ol>
          <span className="mt-1 flex flex-wrap items-center gap-3.5 md:mt-2">
            <Link
              href={LINKS.creators}
              className="rounded-full bg-[#22DDE0] px-[22px] py-[13px] text-[15px] font-bold text-[#072338] no-underline md:px-7 md:py-[15px] md:text-base"
            >
              Join the creator program
            </Link>
            <span className="text-[13px] text-[#A9C2D4]">Free to join · for Instagram and YouTube creators</span>
          </span>
        </div>
        <div
          aria-label="Example of a creator’s earnings"
          className="flex flex-col gap-1 rounded-[20px] bg-white p-4 text-[#0D2436] shadow-[0_30px_70px_rgba(0,0,0,.25)] md:-rotate-[1.5deg] md:rounded-[26px] md:p-6"
        >
          <span className="text-[10.5px] font-bold tracking-[.14em] text-[#566E85]">EXAMPLE · YOUR CREATOR DASHBOARD</span>
          <span className="flex items-center gap-3 pb-3 pt-2.5">
            <Image src={IMG.heroBeach9x16} alt="" width={52} height={64} className="h-16 w-[52px] rounded-xl object-cover" />
            <span className="flex flex-col gap-0.5">
              <strong className="text-[17px]">Slow North Goa</strong>
              <span className="text-[12.5px] text-[#566E85]">Your reel from Dec 2025 · now a bookable trip</span>
            </span>
          </span>
          {CREATOR_DASHBOARD.map((row) => (
            <span key={row.label} className="flex items-baseline justify-between gap-3 border-t border-[#E8EEF4] py-2.5 text-[14.5px]">
              <span className="text-[#566E85]">{row.label}</span>
              <strong className={`tabular-nums ${row.earned ? "text-base text-[#0B7A57]" : "text-[#0D2436]"}`}>{row.value}</strong>
            </span>
          ))}
          <span className="mt-2 text-xs text-[#566E85]">Paid to your bank on the 5th of every month.</span>
        </div>
      </div>
    </section>
  );
}

/** Why it's safe to say yes: rows on phones, four columns on desktop. */
export function Trust() {
  return (
    <section id="b4-trust" className="border-t border-[#E8EEF4] bg-white px-4 py-10 md:px-10 md:py-[88px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-5 flex flex-col gap-1.5 md:mb-9 md:gap-2.5">
          <span className="text-[11px] font-bold tracking-[.16em] text-[#0A7C80] md:text-[12.5px]">WHY IT’S SAFE TO SAY YES</span>
          <h2 className="font-display m-0 text-[30px] font-medium leading-[1.1] tracking-[-0.015em] text-[#0D2436] md:text-[46px]">An agent you can trust with the booking</h2>
        </div>
        <div className="flex flex-col gap-[18px] md:grid md:grid-cols-4 md:gap-8">
          {TRUST.map((t) => (
            <div key={t.title} className="flex items-start gap-3 md:flex-col md:gap-2.5">
              <span className="grid size-10 flex-none place-items-center rounded-xl bg-[#DCF8F9]">
                <Path d={t.icon} stroke="#0A7C80" />
              </span>
              <span className="flex flex-col gap-[3px]">
                <strong className="text-base md:text-[17px]">{t.title}</strong>
                <span className="text-sm leading-normal text-[#3F5A72] md:text-[14.5px]">{t.desc}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Closing call to action and the footer. */
export function StartAndFooter() {
  return (
    <section id="b4-start" className="bg-white px-4 pb-7 pt-11 md:px-10 md:pb-10 md:pt-[88px]">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-3 text-center md:gap-3.5">
        <h2 className="font-display m-0 text-[30px] font-medium leading-[1.12] md:text-[46px]">Start with whatever you have</h2>
        <p className="m-0 text-[15px] leading-normal text-[#3F5A72] md:text-lg">A reel you saved, or just an idea in your head. Arya takes it from there.</p>
        <Link
          href={LINKS.start}
          className="mt-1.5 inline-flex items-center gap-2.5 rounded-full bg-[#072338] px-7 py-3.5 text-base font-semibold text-white no-underline shadow-[0_0_0_5px_rgba(34,221,224,.25)] md:mt-2 md:px-[34px] md:py-4 md:text-[17px]"
        >
          Start planning <span className="text-[#22DDE0]">→</span>
        </Link>
        <SiteFooter />
      </div>
    </section>
  );
}
