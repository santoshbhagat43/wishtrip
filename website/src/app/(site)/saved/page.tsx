"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { PlaceCard } from "@/components/trip/place-card";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";

export default function SavedPage() {
  const saved = useQuery({ queryKey: ["saved"], queryFn: async () => unwrap(await api.GET("/profiles/me/saved")) });
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-[34px] leading-tight">Saved places</h1>
      <p className="mt-1 text-muted">Places you liked. They nudge your recommendations, and you can add them to a plan from the chat.</p>
      {saved.isLoading && <Spinner />}
      <ErrorNote error={saved.error} />
      {saved.data?.length === 0 && (
        <p className="mt-8 rounded-2xl border border-dashed border-border px-6 py-10 text-center text-muted">
          Nothing saved yet. <Link href="/explore" className="font-semibold text-brand">Explore destinations</Link> and tap Save on places you like.
        </p>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {saved.data?.map((s) => <PlaceCard key={s.place.id} place={s.place} saved />)}
      </div>
    </div>
  );
}
