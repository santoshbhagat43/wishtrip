"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, ThumbsDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { api, unwrap, type Place } from "@/lib/api/client";
import { minutes, titleCase } from "@/lib/format";
import { useMe } from "@/lib/session";

import { gradientFor } from "./visuals";

type Signal = "added" | "removed" | "skipped";

export function useSignal(placeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (event_type: Signal) =>
      unwrap(await api.POST("/profiles/me/events", { body: { location_id: placeId, event_type } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      queryClient.invalidateQueries({ queryKey: ["for-you"] });
    },
  });
}

export function SaveButtons({ placeId, saved: initiallySaved = false }: { placeId: string; saved?: boolean }) {
  const { data: me } = useMe();
  const signal = useSignal(placeId);
  const [saved, setSaved] = useState(initiallySaved);
  const [hidden, setHidden] = useState(false);
  if (!me) {
    return <Link href="/signup" className="text-xs font-semibold text-brand">Sign up to save</Link>;
  }
  if (hidden) return <span className="text-xs text-muted">Got it — we&apos;ll show you less like this.</span>;
  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => signal.mutate(saved ? "removed" : "added", { onSuccess: () => setSaved(!saved) })}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${saved ? "border-brand bg-brand text-on-brand" : "border-border hover:border-brand hover:text-brand"}`}
      >
        {saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />} {saved ? "Saved" : "Save"}
      </button>
      {!saved && (
        <button
          onClick={() => signal.mutate("skipped", { onSuccess: () => setHidden(true) })}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted hover:text-text"
        >
          <ThumbsDown className="size-3.5" /> Not for me
        </button>
      )}
    </div>
  );
}

export function PlaceCard({ place, reasons, saved }: { place: Place; reasons?: string[]; saved?: boolean }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-[22px] border border-border bg-surface shadow-card">
      <Link href={`/places/${place.id}`} className="relative block h-28" style={{ background: gradientFor(place.name) }}>
        {place.highlight && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-accent-text">Must-see</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          <Link href={`/places/${place.id}`} className="font-display text-lg leading-tight hover:text-brand">{place.name}</Link>
          <p className="text-xs text-muted">
            {titleCase(place.type)}
            {place.parent ? ` · ${place.parent.name}` : ""}
            {place.duration_minutes != null ? ` · ${minutes(place.duration_minutes)}` : ""}
          </p>
        </div>
        {place.summary && <p className="text-sm text-muted">{place.summary}</p>}
        {reasons && reasons.length > 0 && (
          <div className="flex flex-wrap gap-1">{reasons.slice(0, 3).map((r) => <Badge key={r} tone="ok">{r}</Badge>)}</div>
        )}
        <p className="text-xs">
          <span className="text-muted">Price: </span>
          {place.price_note ? <span className="font-medium">{place.price_note}</span> : <span className="italic text-muted">not available yet</span>}
        </p>
        <div className="mt-auto pt-1"><SaveButtons placeId={place.id} saved={saved} /></div>
      </div>
    </article>
  );
}
