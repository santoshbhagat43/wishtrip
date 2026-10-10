"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Card, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";

function Children({ parentId, depth }: { parentId: string; depth: number }) {
  const children = useQuery({
    queryKey: ["hierarchy", parentId],
    queryFn: async () =>
      unwrap(await api.GET("/admin/locations", { params: { query: { parent_id: parentId, page_size: 200 } } })),
  });
  const counts = useQuery({
    queryKey: ["hierarchy-counts", parentId],
    queryFn: async () =>
      unwrap(await api.GET("/admin/locations/{location_id}/children-counts", { params: { path: { location_id: parentId } } })),
  });
  if (children.isLoading) return <p className="py-2 text-sm text-muted" style={{ paddingLeft: depth * 20 + 28 }}>Loading…</p>;
  const sorted = [...(children.data?.items ?? [])].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return (
    <ul>
      {sorted.map((loc) => (
        <Node key={loc.id} loc={loc} depth={depth} childCount={counts.data?.[loc.id] ?? 0} />
      ))}
    </ul>
  );
}

function Node({
  loc,
  depth,
  childCount,
}: {
  loc: { id: string; name: string; type: string; status: string; region?: string };
  depth: number;
  childCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-2 border-b border-border py-2 pr-4 text-sm hover:bg-surface-2/60" style={{ paddingLeft: depth * 20 + 8 }}>
        {childCount > 0 ? (
          <button aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>
            <ChevronRight className={`size-4 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <MapPin className="size-3.5 text-muted" />
        )}
        <Link href={`/locations/${loc.id}`} className="font-medium hover:text-brand">{loc.name}</Link>
        <span className="text-xs capitalize text-muted">{loc.type}</span>
        {loc.region && <span className="text-xs text-muted">· {loc.region}</span>}
        {childCount > 0 && <span className="text-xs text-muted">· {childCount}</span>}
        <span className="ml-auto"><Badge tone={STATUS_TONE[loc.status]}>{loc.status}</Badge></span>
      </div>
      {open && <Children parentId={loc.id} depth={depth + 1} />}
    </li>
  );
}

export default function HierarchyPage() {
  const countries = useQuery({
    queryKey: ["hierarchy", "root"],
    queryFn: async () => unwrap(await api.GET("/admin/locations", { params: { query: { type: ["country"], page_size: 200 } } })),
  });
  const cities = useQuery({
    queryKey: ["hierarchy", "cities"],
    queryFn: async () => unwrap(await api.GET("/admin/locations", { params: { query: { type: ["city"], page_size: 200 } } })),
  });
  const cityCount = (countryId: string) => cities.data?.items.filter((c) => c.parent?.id === countryId).length ?? 0;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Hierarchy" description="Country → city → places. Expand a row to browse what WishTrip knows there." />
      <Card>
        {countries.isLoading ? (
          <Spinner />
        ) : (
          <ul>
            {[...(countries.data?.items ?? [])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => <Node key={c.id} loc={c} depth={0} childCount={cityCount(c.id)} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
