"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Compass, MessageSquareHeart } from "lucide-react";
import Link from "next/link";

import { gradientFor } from "@/components/trip/visuals";
import { api, unwrap } from "@/lib/api/client";
import { useMe } from "@/lib/session";

export default function Home() {
  const { data: me } = useMe();
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: async () => unwrap(await api.GET("/explore/destinations")) });
  const featured = (destinations.data ?? []).slice().sort((a, b) => b.place_count - a.place_count).slice(0, 6);
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="grid items-center gap-10 py-14 md:grid-cols-[7fr_5fr] md:py-20">
        <div>
          <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-accent-text">Personalised holidays · India &amp; beyond</p>
          <h1 className="mt-3 text-[40px] leading-[1.08] md:text-[52px]">
            See it. <em className="not-italic text-accent">Make it yours.</em> Travel your way.
          </h1>
          <p className="mt-4 max-w-xl text-[16px] text-muted">
            Tell us where you&apos;re dreaming of and who&apos;s coming. We build a day-by-day plan from places our team has checked —
            and we never make up prices.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={me ? "/plan" : "/signup"} className="rounded-full bg-brand px-6 py-3 font-semibold text-on-brand shadow-[0_8px_20px_rgba(15,76,69,0.28)] hover:bg-brand-strong">
              {me ? "Plan a trip" : "Build my trip"}
            </Link>
            <Link href="/explore" className="rounded-full border border-border bg-surface px-6 py-3 font-semibold hover:border-brand">Explore destinations</Link>
            <span className="text-sm text-muted">Free to plan</span>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              [MessageSquareHeart, "Just ask", "Chat in your own words — we work out the rest."],
              [Compass, "Built around you", "Your pace, your people, your interests."],
              [CalendarCheck, "Checked to work", "Opening days, travel time and pace are verified."],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof Compass;
              return (
                <li key={title as string} className="flex gap-3">
                  <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><I className="size-5" /></span>
                  <span><span className="block text-sm font-semibold">{title as string}</span><span className="text-sm text-muted">{text as string}</span></span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="relative hidden md:block">
          <div className="rotate-[1.2deg] overflow-hidden rounded-[28px] bg-surface shadow-[0_20px_46px_rgba(22,33,30,0.20)]">
            <div className="flex h-44 items-end p-5 text-white" style={{ background: gradientFor("Kerala") }}>
              <span className="font-display text-3xl">Kerala, your way</span>
            </div>
            <div className="space-y-2 p-5 text-sm">
              <p className="font-semibold">“5 relaxed days in Kerala with my parents”</p>
              <p className="text-muted">Tea hills at Munnar · backwater sunset · gentle pace, checked day by day.</p>
              <p className="text-xs italic text-muted">Prices: not available yet</p>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="text-[27px]">Where we can take you</h2>
          <Link href="/explore" className="text-sm font-semibold text-brand">All destinations</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((d) => (
            <Link key={d.id} href={`/explore/${d.id}`} className="group overflow-hidden rounded-[22px] border border-border bg-surface shadow-card hover:border-brand">
              <div className="flex h-36 items-end p-4 text-white" style={{ background: gradientFor(d.name) }}>
                <span className="font-display text-2xl">{d.name}</span>
              </div>
              <div className="p-4 text-sm">
                <p className="text-muted">{[d.region, d.country].filter(Boolean).join(" · ")} · {d.place_count} places</p>
                {d.highlights.length > 0 && <p className="mt-1 truncate">{d.highlights.join(" · ")}</p>}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
