"use client";

import Link from "next/link";
import { useState } from "react";

import type { CreatorTripCard } from "@/lib/server/creators";

export type SpotlightTrip = CreatorTripCard & { slug: string; handle?: string | null; creator: string; tag: string | null };

const plan = (prompt: string) => `/plan?prompt=${encodeURIComponent(prompt)}`;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const stops = (n: number) => `${n} ${n === 1 ? "stop" : "stops"}`;

/** Travel creators in the spotlight: a carousel of real, published creator trips. The middle card
 *  is the one in focus; the arrows, dots and the cards beside it move it. */
export function CreatorSpotlight({ trips }: { trips: SpotlightTrip[] }) {
  const [active, setActive] = useState(0);
  const n = trips.length;
  if (n === 0) return null;
  const move = (by: number) => setActive((a) => (a + by + n) % n);
  // Position of card i relative to the one in focus, wrapped to the nearest side.
  const offset = (i: number) => {
    let d = (i - active + n) % n;
    if (d > n / 2) d -= n;
    return d;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-sans! m-0 text-[24px] font-bold tracking-tight text-white md:text-[30px]">Travel creators in the spotlight</h2>
          <p className="m-0 mt-1 text-[14px] text-[#C9DAE6] md:text-[15.5px]">Trips by creators you follow. Watch the reel, then make the trip yours.</p>
        </div>
        <Link href="/creators/trips" className="text-[14.5px] font-semibold text-[#6BEDEF] no-underline hover:underline">
          See all ›
        </Link>
      </div>

      <div className="relative mt-6 h-[540px] md:h-[560px]" role="group" aria-roledescription="carousel" aria-label="Creator trips">
        {trips.map((t, i) => {
          const d = offset(i);
          const visible = Math.abs(d) <= 1 && (n > 1 || d === 0) && (n > 2 || d >= 0);
          const here = d === 0;
          return (
            <article
              key={t.share_code}
              aria-hidden={!here}
              aria-label={`${i + 1} of ${n}: ${t.title}`}
              className="absolute left-1/2 top-0 w-[min(360px,78vw)] transition-all duration-500 ease-out"
              style={{
                transform: `translateX(calc(-50% + ${d * 118}%)) scale(${here ? 1 : 0.86})`,
                opacity: visible ? (here ? 1 : 0.5) : 0,
                zIndex: here ? 3 : 1,
                pointerEvents: visible ? "auto" : "none",
              }}
            >
              <div
                className={`relative flex h-[500px] flex-col justify-end overflow-hidden rounded-[26px] bg-[#0A3A57] text-white shadow-[0_30px_70px_rgba(0,0,0,.35)] md:h-[520px] ${here ? "" : "cursor-pointer"}`}
                onClick={here ? undefined : () => setActive(i)}
              >
                {t.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- backend media
                  <img src={t.cover_image_url} alt="" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <span className="absolute inset-0 bg-gradient-to-br from-[#124A72] to-[#0A7C80]" />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-[#041A2C] via-[#041A2C]/40 to-transparent" />
                {t.tag && (
                  <span className="absolute right-3 top-3 rounded-full bg-white/25 px-3 py-1 text-[12px] font-bold backdrop-blur">{t.tag}</span>
                )}
                <div className="relative flex flex-col items-center gap-2 px-5 pb-5 text-center">
                  <h3 className="font-sans! m-0 text-[26px] font-bold leading-[1.1] tracking-tight md:text-[30px]">
                    <Link href={`/t/${t.share_code}`} tabIndex={here ? 0 : -1} className="text-white no-underline hover:underline">
                      {t.title}
                    </Link>
                  </h3>
                  <p className="m-0 text-[14px] text-[#E6F0F6]">
                    by{" "}
                    <Link href={`/creator/${encodeURIComponent(t.slug)}`} tabIndex={here ? 0 : -1} className="font-semibold text-[#6BEDEF]">
                      {t.handle ? `@${t.handle}` : t.creator}
                    </Link>
                    {t.destination_name ? ` · ${t.destination_name}` : ""}
                  </p>
                  <span className="flex flex-wrap justify-center gap-1.5">
                    {[days(t.days), stops(t.stops)].map((chip) => (
                      <span key={chip} className="rounded-md bg-white/15 px-2.5 py-1 text-[12px] font-bold">
                        {chip}
                      </span>
                    ))}
                  </span>
                  <span className="mt-2 flex flex-wrap justify-center gap-2.5">
                    <Link
                      href={plan(`Plan a trip like "${t.title}" by ${t.creator}`)}
                      tabIndex={here ? 0 : -1}
                      className="rounded-full bg-white px-5 py-2.5 text-[14px] font-bold text-[#072338] no-underline"
                    >
                      Plan this trip
                    </Link>
                    {t.source_url && (
                      <a
                        href={t.source_url}
                        target="_blank"
                        rel="noreferrer"
                        tabIndex={here ? 0 : -1}
                        className="rounded-full border border-white/70 px-5 py-2.5 text-[14px] font-bold text-white no-underline"
                      >
                        ▶ Watch reel
                      </a>
                    )}
                  </span>
                </div>
              </div>
            </article>
          );
        })}

        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label="Previous trip"
              className="absolute left-0 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-[#0B2A44]/90 text-xl text-white hover:bg-[#0B3550] md:left-4"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              aria-label="Next trip"
              className="absolute right-0 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-[#0B2A44]/90 text-xl text-white hover:bg-[#0B3550] md:right-4"
            >
              ›
            </button>
          </>
        )}
      </div>

      {n > 1 && (
        <div className="mt-4 flex justify-center gap-2" role="tablist" aria-label="Choose a trip">
          {trips.map((t, i) => (
            <button
              key={t.share_code}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Show ${t.title}`}
              onClick={() => setActive(i)}
              className={`h-[7px] rounded-full transition-all ${i === active ? "w-6 bg-white" : "w-[7px] bg-white/35"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
