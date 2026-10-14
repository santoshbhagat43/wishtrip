"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PlaceCard } from "@/components/trip/place-card";
import { gradientFor } from "@/components/trip/visuals";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { api, unwrap, type Place } from "@/lib/api/client";
import { titleCase } from "@/lib/format";
import { useMe } from "@/lib/session";

type View = "for-you" | "all";

export default function DestinationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [view, setView] = useState<View>("for-you");
  const [type, setType] = useState("all");
  const detail = useQuery({
    queryKey: ["destination", id],
    queryFn: async () => unwrap(await api.GET("/explore/destinations/{city_id}", { params: { path: { city_id: id } } })),
  });
  const forYou = useQuery({
    queryKey: ["for-you", id],
    enabled: !!me,
    queryFn: async () => unwrap(await api.GET("/recommendations", { params: { query: { city_id: id, limit: 12 } } })),
  });
  const saved = useQuery({ queryKey: ["saved"], enabled: !!me, queryFn: async () => unwrap(await api.GET("/profiles/me/saved")) });
  const savedIds = new Set((saved.data ?? []).map((s) => s.place.id));

  if (detail.isLoading) return <Spinner />;
  if (detail.error) return <div className="p-6"><ErrorNote error={detail.error} /></div>;
  const { destination: d, places } = detail.data!;
  const types = ["all", ...new Set(places.map((p) => p.type))];
  const shown = places.filter((p) => type === "all" || p.type === type);
  const personal = me && view === "for-you";

  return (
    <div>
      <section className="px-4 py-14 text-white" style={{ background: gradientFor(d.name) }}>
        <div className="mx-auto max-w-6xl">
          <Link href="/explore" className="text-sm text-white/80 hover:text-white">← All destinations</Link>
          <h1 className="mt-3 text-[44px] leading-tight">{d.name}</h1>
          <p className="text-white/85">{[d.region, d.country].filter(Boolean).join(" · ")} · {d.place_count} places</p>
          {d.summary && <p className="mt-2 max-w-2xl text-white/90">{d.summary}</p>}
          <Link href={me ? `/plan?prompt=${encodeURIComponent(`Plan a trip to ${d.name}`)}` : "/signup"} className="mt-6 inline-block rounded-full bg-accent px-6 py-3 font-semibold text-white hover:bg-accent-strong">
            Plan a trip to {d.name}
          </Link>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 py-8">
        {me ? (
          <Tabs value={view} onChange={setView} tabs={[{ id: "for-you", label: "Picked for you" }, { id: "all", label: "Everything here" }]} />
        ) : (
          <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">
            <Link href="/signup" className="font-semibold underline">Create a free account</Link> to see places ranked for your pace, people and interests.
          </p>
        )}
        {personal ? (
          forYou.isLoading ? <Spinner label="Ranking for you…" /> : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {forYou.data?.items.map((item) => (
                <PlaceCard key={item.location.id} place={item.location as Place} reasons={item.reasons} saved={savedIds.has(item.location.id)} />
              ))}
            </div>
          )
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-1.5">
              {types.map((t) => (
                <button key={t} onClick={() => setType(t)} className={`rounded-full border px-3 py-1 text-sm font-medium ${type === t ? "border-brand bg-brand text-on-brand" : "border-border text-muted hover:text-text"}`}>
                  {t === "all" ? "All" : titleCase(t)}
                </button>
              ))}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => <PlaceCard key={p.id} place={p} saved={savedIds.has(p.id)} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
