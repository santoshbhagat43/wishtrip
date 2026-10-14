"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Globe2, Plus } from "lucide-react";
import Link from "next/link";

import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";

/** Step 1 of the knowledge base: pick a country. */
export default function DestinationsPage() {
  const countries = useQuery({
    queryKey: ["countries"],
    queryFn: async () => unwrap(await api.GET("/admin/locations", { params: { query: { type: ["country"], page_size: 200 } } })),
  });
  const cities = useQuery({ queryKey: ["destinations"], queryFn: async () => unwrap(await api.GET("/admin/destinations")) });

  if (countries.isLoading || cities.isLoading) return <Spinner />;
  if (countries.error || cities.error) return <ErrorNote error={countries.error ?? cities.error} />;

  const rows = cities.data!;
  const list = [...countries.data!.items].sort((a, b) => a.name.localeCompare(b.name));
  const places = rows.reduce((n, r) => n + r.hotels + r.experiences + r.food, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb="Knowledge base"
        title="Destinations"
        description="Start with a country, then a city. Each city holds its history, hotels, experiences and places to eat."
        action={
          <div className="flex flex-wrap items-center gap-4">
            <HeaderStats
              items={[
                { value: list.length, label: "countries" },
                { value: rows.length, label: "cities" },
                { value: places, label: "places" },
              ]}
            />
            <Link
              href="/locations/new?type=country"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
            >
              <Plus className="size-4" /> Add country
            </Link>
          </div>
        }
      />

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((country) => {
          const own = rows.filter((r) => r.country_id === country.id);
          const placeCount = own.reduce((n, r) => n + r.hotels + r.experiences + r.food, 0);
          const trips = own.reduce((n, r) => n + r.trips, 0);
          const withHistory = own.filter((r) => r.history_words > 0).length;
          return (
            <li key={country.id}>
              <Link
                href={`/destinations/${country.id}`}
                className="group flex h-full flex-col gap-3 rounded-[22px] border border-border bg-surface p-5 shadow-card transition-colors hover:border-brand"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Globe2 className="size-5" />
                  </span>
                  {country.status !== "published" && <Badge tone={STATUS_TONE[country.status]}>{country.status}</Badge>}
                </div>
                <div>
                  <p className="font-display text-xl">{country.name}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {own.length} {own.length === 1 ? "city" : "cities"} · {placeCount} places{trips ? ` · ${trips} trips planned` : ""}
                  </p>
                </div>
                <p className="mt-auto flex items-center justify-between text-xs text-muted">
                  <span>{own.length ? `History written for ${withHistory} of ${own.length}` : "No cities yet"}</span>
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
