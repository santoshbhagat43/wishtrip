"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock, Footprints, Info } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { SaveButtons } from "@/components/trip/place-card";
import { gradientFor } from "@/components/trip/visuals";
import { Badge } from "@/components/ui/badge";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";
import { COST_LABELS, minutes, titleCase } from "@/lib/format";
import { useMe } from "@/lib/session";

export default function PlacePage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const place = useQuery({
    queryKey: ["place", id],
    queryFn: async () => unwrap(await api.GET("/explore/places/{place_id}", { params: { path: { place_id: id } } })),
  });
  const saved = useQuery({ queryKey: ["saved"], enabled: !!me, queryFn: async () => unwrap(await api.GET("/profiles/me/saved")) });
  if (place.isLoading) return <Spinner />;
  if (place.error) return <div className="p-6"><ErrorNote error={place.error} /></div>;
  const p = place.data!;
  const isSaved = (saved.data ?? []).some((s) => s.place.id === p.id);
  const image = p.media.find((m) => m.kind === "image");
  const suits = [p.family_friendly && "Families", p.couple_friendly && "Couples", p.accessible && "Wheelchair accessible"].filter(Boolean);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {p.parent && <Link href={`/explore/${p.parent.id}`} className="text-sm font-medium text-brand">← {p.parent.name}</Link>}
      <div className="mt-3 overflow-hidden rounded-[28px] shadow-raised">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt={image.caption || p.name} className="h-64 w-full object-cover" />
        ) : (
          <div className="h-48" style={{ background: gradientFor(p.name) }} />
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap gap-1.5">
            <Badge>{titleCase(p.type)}</Badge>
            {p.highlight && <Badge tone="brand">Must-see</Badge>}
          </div>
          <h1 className="mt-2 text-[34px] leading-tight">{p.name}</h1>
          {p.summary && <p className="mt-1 text-lg text-muted">{p.summary}</p>}
        </div>
        <SaveButtons placeId={p.id} saved={isSaved} />
      </div>

      <dl className="mt-6 grid gap-3 rounded-[22px] border border-border bg-surface p-5 text-sm shadow-card sm:grid-cols-2">
        <div><dt className="text-xs text-muted">How long</dt><dd className="flex items-center gap-1.5"><Clock className="size-3.5" />{p.duration_minutes != null ? minutes(p.duration_minutes) : <span className="italic text-muted">not known yet</span>}</dd></div>
        <div><dt className="text-xs text-muted">Best time</dt><dd className="capitalize">{p.best_times.join(", ") || "—"}</dd></div>
        <div><dt className="text-xs text-muted">Price</dt><dd>{p.price_note || <span className="italic text-muted">not available yet</span>}</dd></div>
        <div><dt className="text-xs text-muted">Cost level</dt><dd>{p.cost_level != null ? COST_LABELS[p.cost_level] : "—"}</dd></div>
        <div><dt className="text-xs text-muted">Pace</dt><dd>{p.energy_level ? `${p.energy_level}/5 energy` : "—"}</dd></div>
        <div><dt className="text-xs text-muted">Good for</dt><dd>{suits.join(", ") || "—"}</dd></div>
        {typeof p.opening_hours.open_days === "string" && (
          <div className="sm:col-span-2"><dt className="text-xs text-muted">Open</dt><dd className="capitalize">{p.opening_hours.open_days as string}</dd></div>
        )}
      </dl>

      {p.description && <p className="mt-6 leading-relaxed">{p.description}</p>}
      {(p.pros.length > 0 || p.cons.length > 0) && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {p.pros.length > 0 && <div><h2 className="mb-2 text-lg">Why go</h2><ul className="list-disc space-y-1 pl-5 text-sm">{p.pros.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {p.cons.length > 0 && <div><h2 className="mb-2 text-lg">Good to know</h2><ul className="list-disc space-y-1 pl-5 text-sm">{p.cons.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        </div>
      )}
      {p.tips && <p className="mt-6 flex gap-2 rounded-2xl bg-value-soft px-4 py-3 text-sm"><Info className="mt-0.5 size-4 shrink-0" /> {p.tips}</p>}
      {p.nearby.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xl">Pairs well with</h2>
          <ul className="space-y-2">
            {p.nearby.map((n) => (
              <li key={n.place.id} className="flex items-center gap-2 text-sm">
                <Footprints className="size-4 text-muted" />
                <Link href={`/places/${n.place.id}`} className="font-medium hover:text-brand">{n.place.name}</Link>
                <span className="text-muted">· {titleCase(n.relation)}{n.travel_minutes != null ? ` · ${minutes(n.travel_minutes)} away` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
