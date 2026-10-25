import Link from "next/link";

import type { CreatorsIndex } from "@/lib/server/creators";

import { B4Header } from "../header";
import { SiteFooter } from "../footer";
import { Avatar, CHANNEL, Cover, CreatorTile, dayStops, profileHref, tripHref } from "./creator-parts";

/** The Creator trips page (/creators/trips): who is making trips, a creator in the spotlight, and
 *  everyone else. Only real, published creators and trips: no follower or booking figures. */
export function CreatorTripsScreen({ data }: { data: CreatorsIndex | null }) {
  const creators = data?.all ?? [];
  const spotlight = data?.spotlight ?? null;
  const lead = spotlight?.trips[0];

  return (
    <div className="min-h-dvh bg-white text-[#0D2436]">
      <B4Header solid />

      <section className="bg-[radial-gradient(ellipse_at_top,#0B3550_0%,#072338_60%)] px-4 pb-10 pt-[100px] text-center text-white md:px-10 md:pb-14 md:pt-[130px]">
        <p className="m-0 text-[12.5px] font-bold tracking-[.12em] text-[#22DDE0]">CREATOR TRIPS</p>
        <h1 className="font-display m-0 mx-auto mt-3 max-w-[820px] text-[38px] font-medium leading-[1.08] md:text-[60px]">
          Trips made by travel creators{" "}
          <em className="font-display text-[#5CE9EB]">you already follow</em>
        </h1>
        <p className="mx-auto mt-4 max-w-[560px] text-[15.5px] leading-relaxed text-white/80 md:text-[17px]">
          Every trip here started as a creator&rsquo;s reel. See where they went, then make it yours with Arya.
        </p>
        {creators.length > 0 && (
          <>
            <dl className="m-0 mt-7 flex justify-center gap-8 md:gap-12">
              {(
                [
                  [data!.creators, data!.creators === 1 ? "creator" : "creators"],
                  [data!.trips, data!.trips === 1 ? "creator trip" : "creator trips"],
                  [data!.stops, data!.stops === 1 ? "stop planned" : "stops planned"],
                ] as const
              ).map(([n, label]) => (
                <div key={label} className="flex flex-col items-center">
                  <dt className="text-[28px] font-bold leading-none md:text-[34px]">{n}</dt>
                  <dd className="m-0 mt-1 text-[12.5px] text-white/70">{label}</dd>
                </div>
              ))}
            </dl>
            <ul className="m-0 mt-8 flex list-none justify-center gap-4 overflow-x-auto p-0 pb-2 md:gap-6">
              {creators.slice(0, 14).map((c) => (
                <li key={c.slug} className="flex-none">
                  <Link href={profileHref(c)} className="flex w-[78px] flex-col items-center gap-2 text-white no-underline md:w-[92px]">
                    <span className="rounded-full border-2 border-[#22DDE0] p-[3px]">
                      <Avatar name={c.display_name} src={c.avatar_url} size={64} />
                    </span>
                    <span className="max-w-full truncate text-[12.5px] font-medium">{c.display_name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <main className="mx-auto max-w-[1240px] px-4 md:px-10">
        {creators.length === 0 && (
          <section className="my-14 rounded-[28px] border border-[#E3E8EE] bg-[#F3F6F9] p-8 text-center md:p-14">
            <h2 className="font-display m-0 text-[28px] font-medium md:text-[36px]">
              {data ? "The first creator trips are on their way" : "We couldn't load the creator trips"}
            </h2>
            <p className="mx-auto mt-3 max-w-[480px] text-[15px] text-[#566E85]">
              {data
                ? "Creators are turning their reels into trips right now. Check back soon, or join them."
                : "Please try again in a moment."}
            </p>
            <Link href="/creators" className="mt-6 inline-flex rounded-full bg-[#072338] px-6 py-3 text-[15px] font-semibold text-white no-underline">
              Join the creator program
            </Link>
          </section>
        )}

        {spotlight && (
          <section className="mt-12 md:mt-16" aria-labelledby="spotlight">
            <p id="spotlight" className="m-0 text-[12.5px] font-bold tracking-[.1em] text-[#0A7C80]">
              CREATOR IN THE SPOTLIGHT
            </p>
            <div className="mt-4 grid gap-6 rounded-[28px] border border-[#E3E8EE] bg-white p-4 shadow-[0_14px_40px_rgba(7,35,56,.08)] md:grid-cols-[320px_1fr] md:gap-10 md:p-7">
              <Link
                href={lead ? tripHref(lead) : profileHref(spotlight)}
                className="relative block aspect-[3/4] overflow-hidden rounded-[22px] bg-[#072338] md:aspect-[9/14]"
              >
                <Cover src={spotlight.cover_image_url} />
                <span className="absolute inset-0 bg-gradient-to-t from-[#072338]/85 via-transparent to-[#072338]/25" />
                <span className="absolute left-3 top-3 rounded-full bg-[rgba(7,35,56,.78)] px-3 py-1 text-[11.5px] font-semibold text-white">
                  {CHANNEL[spotlight.channel] ?? "Instagram"} · creator trip
                </span>
                {lead && (
                  <span className="absolute inset-x-4 bottom-4 flex flex-col gap-1 text-white">
                    <strong className="font-display text-[26px] font-medium leading-tight">{lead.title}</strong>
                    <span className="text-[13px] text-white/85">{dayStops(lead)}</span>
                  </span>
                )}
              </Link>
              <div className="flex flex-col justify-center gap-4">
                <div className="flex items-center gap-4">
                  <Avatar name={spotlight.display_name} src={spotlight.avatar_url} size={64} />
                  <div className="flex flex-col leading-tight">
                    <h2 className="font-display m-0 text-[32px] font-medium md:text-[40px]">{spotlight.display_name}</h2>
                    {spotlight.handle && (
                      <span className="text-[14.5px] font-medium text-[#0A7C80]">
                        @{spotlight.handle} · {CHANNEL[spotlight.channel] ?? "Instagram"}
                      </span>
                    )}
                  </div>
                </div>
                {lead?.summary && <p className="m-0 max-w-[560px] text-[16px] leading-relaxed text-[#3F5A72]">{lead.summary}</p>}
                <p className="m-0 text-[14px] text-[#566E85]">
                  <strong className="text-[#0D2436]">{spotlight.trips.length}</strong>{" "}
                  {spotlight.trips.length === 1 ? "trip" : "trips"} on wishtrip ·{" "}
                  <strong className="text-[#0D2436]">{spotlight.trips.reduce((n, t) => n + t.stops, 0)}</strong> stops
                </p>
                <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
                  {spotlight.trips.slice(0, 2).map((t) => (
                    <li key={t.share_code}>
                      <Link href={tripHref(t)} className="flex items-center gap-3 rounded-[16px] border border-[#E3E8EE] p-2.5 no-underline hover:bg-[#F3F6F9]">
                        <span className="size-14 flex-none overflow-hidden rounded-xl bg-[#F3F6F9]">
                          <Cover src={t.cover_image_url} />
                        </span>
                        <span className="flex min-w-0 flex-col leading-snug">
                          <strong className="truncate text-[14.5px] text-[#0D2436]">{t.title}</strong>
                          <span className="text-[12.5px] text-[#566E85]">{dayStops(t)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href={profileHref(spotlight)}
                  className="mt-1 inline-flex w-fit items-center gap-2 rounded-full bg-[#072338] px-6 py-3.5 text-[15px] font-semibold text-white no-underline"
                >
                  See {spotlight.display_name.split(" ")[0]}&rsquo;s page <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </section>
        )}

        {creators.length > 0 && (
          <section className="mt-14 md:mt-20" aria-labelledby="all-creators">
            <p className="m-0 text-[12.5px] font-bold tracking-[.1em] text-[#0A7C80]">ALL CREATORS</p>
            <h2 id="all-creators" className="font-display m-0 mt-2 text-[30px] font-medium md:text-[40px]">
              More creators who travel like you
            </h2>
            <ul className="m-0 mt-6 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {creators.map((c) => (
                <li key={c.slug}>
                  <CreatorTile creator={c} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <section className="mt-14 bg-[#072338] px-4 py-12 text-white md:mt-20 md:px-10 md:py-16">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div>
            <p className="m-0 text-[12.5px] font-bold tracking-[.12em] text-[#22DDE0]">ARE YOU A TRAVEL CREATOR?</p>
            <h2 className="font-display m-0 mt-2 text-[30px] font-medium md:text-[42px]">Turn your reels into trips people book.</h2>
            <p className="m-0 mt-2 text-[15px] text-white/75">Earn on every booking. We handle the planning and support.</p>
          </div>
          <Link href="/creators" className="rounded-full bg-[#22DDE0] px-7 py-4 text-[16px] font-bold text-[#072338] no-underline">
            Join the creator program →
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-[1240px] px-4 pb-8 md:px-10">
        <SiteFooter />
      </div>
    </div>
  );
}
