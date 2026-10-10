"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ChevronRight, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Completeness } from "@/components/completeness";
import { LocationForm, fromLocation, type LocationFormValue } from "@/components/location/location-form";
import { MediaPanel } from "@/components/location/media-panel";
import { RelationsPanel } from "@/components/location/relations-panel";
import { SourcePanel } from "@/components/location/source-panel";
import { SourceBadge } from "@/components/source-badge";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { api, unwrap, type Location } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";

type View = "edit" | "media" | "relations" | "source";

export default function LocationPage() {
  const { id } = useParams<{ id: string }>();
  const location = useQuery({
    queryKey: ["location", id],
    queryFn: async () => unwrap(await api.GET("/admin/locations/{location_id}", { params: { path: { location_id: id } } })),
  });
  if (location.isLoading) return <Spinner />;
  if (location.error) return <ErrorNote error={location.error} />;
  // Remount the editor whenever the saved record changes, so the form always starts from it.
  return <LocationEditor key={location.data!.updated_at} loc={location.data!} />;
}

function LocationEditor({ loc }: { loc: Location }) {
  const id = loc.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("edit");
  const original = useMemo(() => fromLocation(loc), [loc]);
  const [form, setForm] = useState<LocationFormValue>(original);

  const changes = useMemo(() => {
    return Object.fromEntries(
      Object.entries(form).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(original[k as keyof LocationFormValue])),
    );
  }, [form, original]);
  const dirty = Object.keys(changes).length > 0;

  const refresh = (data: unknown) => {
    queryClient.setQueryData(["location", id], data);
    queryClient.invalidateQueries({ queryKey: ["locations"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      unwrap(await api.PATCH("/admin/locations/{location_id}", { params: { path: { location_id: id } }, body })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE("/admin/locations/{location_id}", { params: { path: { location_id: id } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      router.replace("/locations");
    },
  });

  const needsVerification = loc.provenance?.needs_verification === true;
  const isContainer = loc.type === "country" || loc.type === "city";

  function verify() {
    save.mutate({
      provenance: { ...loc.provenance, needs_verification: false, verified_at: new Date().toISOString().slice(0, 10) },
    });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href="/locations" className="hover:text-text">Locations</Link>
        {loc.ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" />
            <Link href={`/locations/${a.id}`} className="hover:text-text">{a.name}</Link>
          </span>
        ))}
      </nav>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[27px] leading-tight">{loc.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge className="capitalize">{loc.type}</Badge>
            <Badge tone={STATUS_TONE[loc.status]}>{loc.status}</Badge>
            {loc.highlight && <Badge tone="brand">Highlight</Badge>}
            <SourceBadge source={loc.source} provenance={loc.provenance} />
            <Completeness value={loc.completeness ?? 1} missing={loc.missing_fields} />
            {loc.status === "published" && (
              <Badge tone={loc.embedding_stale ? "warn" : "ok"}>
                {loc.embedding_stale ? "Search index updating" : "Indexed for AI"}
              </Badge>
            )}
          </div>
          {(loc.missing_fields?.length ?? 0) > 0 && (
            <p className="mt-2 text-sm text-muted">Missing: {loc.missing_fields!.join(", ")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {needsVerification && (
            <Button variant="secondary" onClick={verify} disabled={save.isPending}>
              <BadgeCheck className="size-4" /> Mark verified
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => confirm(`Delete “${loc.name}”? This cannot be undone.`) && remove.mutate()}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
          <Button variant="accent" onClick={() => save.mutate(changes)} disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>

      <div className="mb-4 space-y-2">
        <ErrorNote error={save.error ?? remove.error} />
        {isContainer && loc.children_count > 0 && (
          <p className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
            <span>{loc.children_count} locations inside {loc.name}.</span>
            <Link className="font-medium text-brand" href={`/locations?parent_id=${loc.id}`}>View them</Link>
            <Link className="flex items-center gap-1 font-medium text-brand" href={`/locations/new?parent_id=${loc.id}&type=${loc.type === "country" ? "city" : "attraction"}`}>
              <Plus className="size-3.5" /> Add one
            </Link>
          </p>
        )}
      </div>

      <div className="mb-4">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { id: "edit", label: "Edit" },
            { id: "media", label: "Media" },
            { id: "relations", label: "Relationships" },
            { id: "source", label: "Source" },
          ]}
        />
      </div>
      {view === "edit" && <LocationForm value={form} onChange={setForm} isNew={false} />}
      {view === "media" && <MediaPanel locationId={id} />}
      {view === "relations" && <RelationsPanel locationId={id} />}
      {view === "source" && <SourcePanel location={loc} />}
      <p className="mt-4 text-xs text-muted">Last updated {relativeTime(loc.updated_at)} · slug {loc.slug}</p>
    </div>
  );
}
