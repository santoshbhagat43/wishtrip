"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { ErrorNote, Spinner } from "@/components/ui/card";
import { gradientFor } from "@/components/trip/visuals";
import { api, unwrap } from "@/lib/api/client";

export default function ExplorePage() {
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: async () => unwrap(await api.GET("/explore/destinations")) });
  const byCountry = new Map<string, NonNullable<typeof destinations.data>>();
  for (const d of destinations.data ?? []) byCountry.set(d.country ?? "Other", [...(byCountry.get(d.country ?? "Other") ?? []), d]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-accent-text">Live now</p>
      <h1 className="mt-2 text-[40px] leading-tight">Explore destinations</h1>
      <p className="mt-2 max-w-xl text-muted">Every place here has been added by our team. Pick a destination to see what fits you.</p>
      {destinations.isLoading && <Spinner />}
      <ErrorNote error={destinations.error} />
      {[...byCountry.entries()].map(([country, list]) => (
        <section key={country} className="mt-10">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-muted">{country}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((d) => (
              <Link key={d.id} href={`/explore/${d.id}`} className="overflow-hidden rounded-[22px] border border-border bg-surface shadow-card transition-shadow hover:border-brand hover:shadow-raised">
                <div className="flex h-40 items-end p-4 text-white" style={{ background: gradientFor(d.name) }}>
                  <div>
                    <span className="font-display text-[22px] leading-tight">{d.name}</span>
                    {d.region && <span className="block text-sm text-white/85">{d.region}</span>}
                  </div>
                </div>
                <div className="space-y-1 p-4 text-sm">
                  <p className="text-muted">{d.place_count} places</p>
                  {d.summary && <p className="line-clamp-2">{d.summary}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
