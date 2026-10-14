"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { api, unwrap } from "@/lib/api/client";

const KIND_LABEL: Record<string, string> = {
  stay: "Stay", food: "Food", sight: "Sight", experience: "Experience", area: "Area", note: "Note",
};

/** A creator's shared itinerary. Opening it credits the creator (affiliate), then invites the
 *  visitor to plan the same trip. */
export default function PublicTripPage() {
  const { code } = useParams<{ code: string }>();
  const trip = useQuery({
    queryKey: ["public-trip", code],
    retry: false,
    queryFn: async () => {
      const r = await api.GET("/trips/{share_code}", { params: { path: { share_code: code } } });
      return r.response.status === 404 ? null : unwrap(r);
    },
  });

  // Credit the creator once we know who they are.
  const referralCode = trip.data?.creator.referral_code;
  useEffect(() => {
    if (!referralCode) return;
    fetch("/api/creator-visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referralCode }),
    }).catch(() => {});
  }, [referralCode]);

  if (trip.isLoading) return <div className="mx-auto max-w-2xl px-4 py-16 text-muted">Loading…</div>;
  if (!trip.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-[28px] leading-tight">This trip isn&rsquo;t available</h1>
        <p className="mt-2 text-muted">The link may be wrong or the creator unpublished it.</p>
        <Link href="/" className="mt-5 inline-block"><Button>Explore wishtrip</Button></Link>
      </div>
    );
  }

  const t = trip.data;
  const who = t.creator.display_name || (t.creator.handle ? `@${t.creator.handle}` : "a creator");
  const seed = `Plan a trip to ${t.destination_name || "this place"}${
    t.items.length ? `. I want to see: ${t.items.filter((i) => i.kind !== "note").map((i) => i.name).slice(0, 10).join(", ")}` : ""
  }.`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {t.cover_image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- backend media
        <img src={t.cover_image_url} alt="" className="mb-5 h-56 w-full rounded-[22px] object-cover" />
      )}
      <p className="text-sm font-semibold text-brand">A trip by {who}</p>
      <h1 className="mt-1 text-[34px] leading-tight">{t.title}</h1>
      {t.summary && <p className="mt-2 text-muted">{t.summary}</p>}

      <ol className="mt-6 flex flex-col gap-2">
        {t.items.map((i) => (
          <li key={i.id} className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-3.5">
            <span className="mt-0.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">
              {KIND_LABEL[i.kind] ?? "Stop"}
            </span>
            <span className="flex flex-col">
              <strong className="text-[15px]">{i.name}</strong>
              {i.note && <span className="text-sm text-muted">{i.note}</span>}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-col items-start gap-3 rounded-[22px] border border-border bg-surface p-6 shadow-card">
        <h2 className="text-xl">Make it yours</h2>
        <p className="text-sm text-muted">Plan this trip around your dates, pace and budget — our AI builds the day-by-day.</p>
        <Link href={`/plan?prompt=${encodeURIComponent(seed)}`}><Button>Plan this trip</Button></Link>
      </div>
    </div>
  );
}
