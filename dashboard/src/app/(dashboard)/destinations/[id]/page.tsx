"use client";

import { useQuery } from "@tanstack/react-query";
import { BedDouble, BookOpenText, ChevronRight, Compass, MapPin, PenSquare, Plus, Utensils } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { HistoryEditor } from "@/components/destination/history-editor";
import { PlaceSection, SECTIONS, type SectionKey } from "@/components/destination/place-section";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { api, unwrap, type Location, type Schemas } from "@/lib/api/client";

type CityRow = Schemas["DestinationRow"];
type Tab = "history" | SectionKey;

function Crumbs({ loc }: { loc: Location }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
      <Link href="/destinations" className="hover:text-brand">Destinations</Link>
      {loc.ancestors.map((a) => (
        <span key={a.id} className="flex items-center gap-1">
          <ChevronRight className="size-3" />
          <Link href={`/destinations/${a.id}`} className="hover:text-brand">{a.name}</Link>
        </span>
      ))}
      <ChevronRight className="size-3" />
      <span className="text-text">{loc.name}</span>
    </nav>
  );
}

function EditDetails({ id }: { id: string }) {
  return (
    <Link
      href={`/locations/${id}`}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
    >
      <PenSquare className="size-4" /> Edit details
    </Link>
  );
}

/** Step 2: a country's cities, plus the country's own history. */
function CountryView({ loc }: { loc: Location }) {
  const cities = useQuery({ queryKey: ["destinations"], queryFn: async () => unwrap(await api.GET("/admin/destinations")) });
  const own = (cities.data ?? []).filter((r) => r.country_id === loc.id).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="mx-auto max-w-6xl">
      <Crumbs loc={loc} />
      <PageHeader
        title={loc.name}
        description="Pick a city to write its history and manage its hotels, experiences and places to eat."
        action={
          <div className="flex gap-2">
            <EditDetails id={loc.id} />
            <Link
              href={`/locations/new?type=city&parent_id=${loc.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-navy hover:bg-accent-strong"
            >
              <Plus className="size-4" /> Add city
            </Link>
          </div>
        }
      />
      {cities.isLoading ? (
        <Spinner />
      ) : own.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-muted">No cities in {loc.name} yet — add the first one.</Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {own.map((city) => <CityCard key={city.id} city={city} />)}
        </ul>
      )}
      <Card className="mt-6">
        <div className="border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><BookOpenText className="size-4 text-brand" /> About {loc.name}</h2>
          <p className="mt-0.5 text-sm text-muted">The country&apos;s own history and background.</p>
        </div>
        <div className="p-5"><HistoryEditor key={loc.id} loc={loc} /></div>
      </Card>
    </div>
  );
}

function CityCard({ city }: { city: CityRow }) {
  return (
    <li>
      <Link
        href={`/destinations/${city.id}`}
        className="group flex h-full flex-col gap-3 rounded-[22px] border border-border bg-surface p-5 shadow-card transition-colors hover:border-brand"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-xl leading-tight">{city.name}</p>
            <p className="mt-0.5 line-clamp-1 text-sm text-muted">{city.summary || city.region || " "}</p>
          </div>
          {city.status !== "published" && <Badge tone={STATUS_TONE[city.status]}>{city.status}</Badge>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              ["Hotels", city.hotels, BedDouble],
              ["Experiences", city.experiences, Compass],
              ["Food", city.food, Utensils],
            ] as const
          ).map(([label, n, Icon]) => (
            <div key={label} className="rounded-xl bg-surface-2 px-2 py-2">
              <Icon className="mx-auto size-4 text-muted" />
              <p className="mt-1 font-semibold tabular-nums">{n}</p>
              <p className="text-[11px] text-muted">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-auto flex items-center justify-between text-xs">
          {city.history_words > 0 ? (
            <span className="text-ok">History · {city.history_words} words</span>
          ) : (
            <span className="text-warn">History not written yet</span>
          )}
          <span className="text-muted">{city.trips ? `${city.trips} trips` : ""}</span>
        </p>
      </Link>
    </li>
  );
}

/** Step 3: a city — History · Hotels · Experiences · Food & drink. */
function CityView({ loc }: { loc: Location }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = ((params.get("tab") as Tab) || "history") as Tab;
  const cities = useQuery({ queryKey: ["destinations"], queryFn: async () => unwrap(await api.GET("/admin/destinations")) });
  const row = cities.data?.find((r) => r.id === loc.id);
  const count = (k: SectionKey) => (row ? row[k] : undefined);

  return (
    <div className="mx-auto max-w-5xl">
      <Crumbs loc={loc} />
      <PageHeader
        title={loc.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={STATUS_TONE[loc.status]}>{loc.status}</Badge>
            {loc.region && <span className="flex items-center gap-1"><MapPin className="size-3.5" /> {loc.region}</span>}
            {loc.aliases?.length ? <span>Also known as {loc.aliases.join(", ")}</span> : null}
          </span>
        }
        action={<EditDetails id={loc.id} />}
      />
      <Card>
        <div className="px-5 pt-1">
          <Tabs
            value={tab}
            onChange={(next) => router.replace(`/destinations/${loc.id}?tab=${next}`, { scroll: false })}
            tabs={[
              { id: "history", label: "History" },
              ...(Object.keys(SECTIONS) as SectionKey[]).map((k) => ({ id: k, label: SECTIONS[k].label, count: count(k) })),
            ]}
          />
        </div>
        <div className="p-5">
          {tab === "history" ? <HistoryEditor key={loc.id} loc={loc} /> : <PlaceSection key={tab} cityId={loc.id} section={tab} />}
        </div>
      </Card>
    </div>
  );
}

function Destination() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const location = useQuery({
    queryKey: ["location", id],
    queryFn: async () => unwrap(await api.GET("/admin/locations/{location_id}", { params: { path: { location_id: id } } })),
  });
  const type = location.data?.type;
  // Places (hotels, experiences…) have their own editor; this page is for countries and cities.
  useEffect(() => {
    if (type && type !== "country" && type !== "city") router.replace(`/locations/${id}`);
  }, [type, id, router]);

  if (location.isLoading) return <Spinner />;
  if (location.error) return <ErrorNote error={location.error} />;
  const loc = location.data!;
  if (loc.type === "country") return <CountryView loc={loc} />;
  if (loc.type === "city") return <CityView loc={loc} />;
  return <Spinner />;
}

export default function DestinationPage() {
  return (
    <Suspense>
      <Destination />
    </Suspense>
  );
}
