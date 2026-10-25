import Link from "next/link";

import type { CreatorPage } from "@/lib/server/creators";

import { B4Header } from "../header";
import { SiteFooter } from "../footer";
import { Avatar, CHANNEL, Cover, CreatorTile, dayStops, tripHref } from "./creator-parts";

const plan = (prompt: string) => `/arya?prompt=${encodeURIComponent(prompt)}`;

/** A creator's own page (/creator/<handle>): who they are and the trips they really took. Real
 *  data only: their published trips, the places in them, and links to their reels. */
export function CreatorProfileScreen({ data }: { data: CreatorPage }) {
  const { creator, more } = data;
  const first = creator.display_name.split(" ")[0];
  const stops = creator.trips.reduce((n, t) => n + t.stops, 0);
  const places = [...new Set(creator.trips.map((t) => t.destination_name).filter(Boolean))];
  const reels = creator.trips.filter((t) => t.source_url);
  const channel = CHANNEL[creator.channel] ?? "Instagram";

  return (
    <div className="min-h-dvh bg-white text-[#0D2436]">
      <B4Header solid />

      <section className="relative h-[240px] overflow-hidden bg-[#072338] md:h-[300px]">
        <Cover src={creator.cover_image_url} />
        <span className="absolute inset-0 bg-gradient-to-b from-[#072338]/55 via-transparent to-[#072338]/25" />
        <Link
          href="/creators/trips"
          className="absolute left-4 top-[84px] inline-flex items-center gap-1.5 rounded-full bg-[rgba(7,35,56,.78)] px-3.5 py-2 text-[13px] font-semibold text-white no-underline md:left-10 md:top-[104px]"
        >
          <span aria-hidden>‹</span> All creators
        </Link>
      </section>

      <main className="mx-auto max-w-[1240px] px-4 md:px-10">
        <header className="-mt-14 flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-3">
            <Avatar name={creator.display_name} src={creator.avatar_url} size={104} ring />
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#DCF8F9] px-3 py-1 text-[12px] font-bold text-[#0A6B6E]">
              ✓ wishtrip creator
            </span>
            <h1 className="font-display m-0 text-[40px] font-medium leading-[1.05] md:text-[58px]">{creator.display_name}</h1>
            {creator.handle && (
              <p className="m-0 text-[15px] text-[#566E85]">
                {creator.profile_url ? (
                  <a href={creator.profile_url} target="_blank" rel="noreferrer" className="font-semibold text-[#0A7C80] no-underline hover:underline">
                    @{creator.handle}
                  </a>
                ) : (
                  <span className="font-semibold text-[#0A7C80]">@{creator.handle}</span>
                )}{" "}
                · {channel}
              </p>
            )}
            {places.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {places.map((p) => (
                  <li key={p} className="rounded-full border border-[#E3E8EE] px-3 py-1 text-[12.5px] font-medium text-[#3F5A72]">
                    {p}
                  </li>
                ))}
              </ul>
            )}
            <dl className="m-0 mt-1 flex gap-8">
              {(
                [
                  [creator.trips.length, creator.trips.length === 1 ? "trip on wishtrip" : "trips on wishtrip"],
                  [stops, stops === 1 ? "stop planned" : "stops planned"],
                ] as const
              ).map(([n, label]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-[26px] font-bold leading-none">{n}</dt>
                  <dd className="m-0 mt-1 text-[12.5px] text-[#566E85]">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Link
            href={plan(`Plan a trip like ${creator.display_name}'s`)}
            className="inline-flex items-center gap-2 rounded-full bg-[#072338] px-6 py-3.5 text-[15px] font-semibold text-white no-underline"
          >
            Plan a trip like {first} <span aria-hidden>→</span>
          </Link>
        </header>

        <section className="mt-14 md:mt-20" aria-labelledby="trips">
          <p className="m-0 text-[12.5px] font-bold tracking-[.1em] text-[#0A7C80]">TRIPS BY {first.toUpperCase()}</p>
          <h2 id="trips" className="font-display m-0 mt-2 text-[30px] font-medium md:text-[42px]">
            The trips they actually took
          </h2>
          <ul className={`m-0 mt-6 grid list-none gap-6 p-0 ${creator.trips.length > 1 ? "md:grid-cols-2" : "max-w-[760px]"}`}>
            {creator.trips.map((t) => (
              <li key={t.share_code} className="overflow-hidden rounded-[24px] border border-[#E3E8EE] bg-white">
                <Link href={tripHref(t)} className="relative block aspect-[16/10] overflow-hidden bg-[#072338]">
                  <Cover src={t.cover_image_url} />
                  <span className="absolute inset-0 bg-gradient-to-t from-[#072338]/60 via-transparent to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full bg-[rgba(7,35,56,.78)] px-3 py-1 text-[12px] font-semibold text-white">
                    {t.destination_name ? `${t.destination_name} · ` : ""}
                    {t.days} {t.days === 1 ? "day" : "days"}
                  </span>
                </Link>
                <div className="flex flex-col gap-2 p-5">
                  {t.source_url && (
                    <a href={t.source_url} target="_blank" rel="noreferrer" className="w-fit text-[12.5px] font-semibold text-[#0A7C80] no-underline hover:underline">
                      ▶ Watch the reel
                    </a>
                  )}
                  <strong className="font-display text-[26px] font-medium leading-tight">{t.title}</strong>
                  {t.summary && <p className="m-0 line-clamp-2 text-[14px] text-[#566E85]">{t.summary}</p>}
                  <span className="text-[13px] text-[#566E85]">{dayStops(t)}</span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={plan(`Plan a trip like "${t.title}" by ${creator.display_name}`)}
                      className="rounded-full bg-[#22DDE0] px-5 py-2.5 text-[14px] font-bold text-[#072338] no-underline"
                    >
                      Make it mine
                    </Link>
                    <Link href={tripHref(t)} className="rounded-full border border-[#E3E8EE] px-5 py-2.5 text-[14px] font-semibold text-[#0D2436] no-underline hover:bg-[#F3F6F9]">
                      See day by day
                    </Link>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {reels.length > 1 && (
          <section className="mt-14 md:mt-20" aria-labelledby="reels">
            <p className="m-0 text-[12.5px] font-bold tracking-[.1em] text-[#0A7C80]">REELS</p>
            <h2 id="reels" className="font-display m-0 mt-2 text-[30px] font-medium md:text-[42px]">
              Where {first} has been
            </h2>
            <ul className="m-0 mt-6 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-4">
              {reels.map((t) => (
                <li key={t.share_code}>
                  <a
                    href={t.source_url!}
                    target="_blank"
                    rel="noreferrer"
                    className="relative block aspect-[9/14] overflow-hidden rounded-[20px] bg-[#072338]"
                  >
                    <Cover src={t.cover_image_url} />
                    <span className="absolute inset-0 bg-gradient-to-t from-[#072338]/70 via-transparent to-transparent" />
                    <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#072338]">
                      ▶
                    </span>
                    <span className="absolute inset-x-3 bottom-3 truncate text-[12.5px] font-semibold text-white">{t.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {more.length > 0 && (
          <section className="mt-14 pb-4 md:mt-20" aria-labelledby="more">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="more" className="font-display m-0 text-[28px] font-medium md:text-[38px]">
                More creators like this
              </h2>
              <Link href="/creators/trips" className="text-[14px] font-semibold text-[#0A7C80] no-underline hover:underline">
                See all
              </Link>
            </div>
            <ul className="m-0 mt-5 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((c) => (
                <li key={c.slug}>
                  <CreatorTile creator={c} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="pb-8">
          <SiteFooter />
        </div>
      </main>
    </div>
  );
}
