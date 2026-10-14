"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Completeness } from "@/components/completeness";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Empty, ErrorNote, Spinner } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { api, unwrap, type LocationType } from "@/lib/api/client";
import { titleCase } from "@/lib/format";

export const SECTIONS = {
  hotels: { label: "Hotels", one: "hotel", types: ["hotel"] as LocationType[], add: "hotel" as LocationType },
  experiences: {
    label: "Experiences",
    one: "experience",
    types: ["attraction", "experience", "activity", "route"] as LocationType[],
    add: "experience" as LocationType,
  },
  food: { label: "Food & drink", one: "place to eat", types: ["restaurant"] as LocationType[], add: "restaurant" as LocationType },
} as const;
export type SectionKey = keyof typeof SECTIONS;

const NOTES: Record<SectionKey, string> = {
  hotels:
    "Imported hotels start as drafts with unverified rates; verify and publish them in the Review queue. Drafts never reach travellers or the trip planner.",
  experiences: "Things to do: sights, guided experiences, activities and scenic routes.",
  food: "Restaurants, cafés and street-food spots the planner can fit around the day.",
};

/** One section of a city page: its places of these types, newest edits first, with an Add button. */
export function PlaceSection({ cityId, section }: { cityId: string; section: SectionKey }) {
  const meta = SECTIONS[section];
  const [q, setQ] = useState("");
  const places = useQuery({
    queryKey: ["city-section", cityId, section],
    queryFn: async () =>
      unwrap(await api.GET("/admin/locations", { params: { query: { parent_id: cityId, type: [...meta.types], page_size: 200 } } })),
  });
  const items = [...(places.data?.items ?? [])]
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "published" ? -1 : 1));
  const published = places.data?.items.filter((p) => p.status === "published").length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">{NOTES[section]}</p>
        <Link
          href={`/locations/new?type=${meta.add}&parent_id=${cityId}`}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
        >
          <Plus className="size-4" /> Add {meta.one}
        </Link>
      </div>
      {(places.data?.items.length ?? 0) > 6 && (
        <label className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" placeholder={`Search ${meta.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {places.isLoading ? (
        <Spinner />
      ) : places.error ? (
        <ErrorNote error={places.error} />
      ) : items.length === 0 ? (
        <Empty title={q ? "No matches" : `No ${meta.label.toLowerCase()} yet`}>{!q && `Add the first ${meta.one} for this city.`}</Empty>
      ) : (
        <>
          <p className="text-xs text-muted">
            {places.data!.items.length} in total · {published} published
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`/locations/${p.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.highlight && <Badge tone="brand">Highlight</Badge>}
                      {section === "experiences" && <span className="text-xs text-muted">{titleCase(p.type)}</span>}
                    </p>
                    {p.summary && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{p.summary}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden sm:block"><Completeness value={p.completeness ?? 1} missing={p.missing_fields} /></span>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
