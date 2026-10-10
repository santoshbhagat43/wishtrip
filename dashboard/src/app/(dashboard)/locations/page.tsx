"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Completeness } from "@/components/completeness";
import { SourceBadge } from "@/components/source-badge";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, unwrap, type LocationType } from "@/lib/api/client";
import { LOCATION_TYPES, STATUSES, relativeTime, titleCase } from "@/lib/format";

const PAGE_SIZE = 25;

function LocationsTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const filters = {
    type: params.get("type") ?? "",
    status: params.get("status") ?? "",
    source: params.get("source") ?? "",
    needs_verification: params.get("needs_verification") ?? "",
    parent_id: params.get("parent_id") ?? "",
    page: Number(params.get("page") ?? 1),
  };

  // Navigation is async, so build on changes that haven't reached the URL yet.
  const pending = useRef<URLSearchParams | null>(null);
  useEffect(() => {
    pending.current = null;
  }, [params]);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(pending.current ?? params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    pending.current = next;
    router.replace(`${pathname}?${next.toString()}`);
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) update({ q });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = useQuery({
    queryKey: ["locations", filters, params.get("q")],
    queryFn: async () =>
      unwrap(
        await api.GET("/admin/locations", {
          params: {
            query: {
              type: filters.type ? [filters.type as LocationType] : undefined,
              status: (filters.status || undefined) as "draft" | "published" | "archived" | undefined,
              source: filters.source || undefined,
              needs_verification: filters.needs_verification ? filters.needs_verification === "true" : undefined,
              parent_id: filters.parent_id || undefined,
              q: params.get("q") || undefined,
              page: filters.page,
              page_size: PAGE_SIZE,
            },
          },
        }),
      ),
    placeholderData: (previous) => previous,
  });

  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input className="pl-8" placeholder="Search by name or summary" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-auto" value={filters.type} onChange={(e) => update({ type: e.target.value })} aria-label="Type">
          <option value="">All types</option>
          {LOCATION_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
        <Select className="w-auto" value={filters.status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        <Select className="w-auto" value={filters.source} onChange={(e) => update({ source: e.target.value })} aria-label="Source">
          <option value="">Any source</option>
          <option value="goexperience-kb">Client KB</option>
          <option value="manual">Manual</option>
        </Select>
        <Select
          className="w-auto"
          value={filters.needs_verification}
          onChange={(e) => update({ needs_verification: e.target.value })}
          aria-label="Verification"
        >
          <option value="">Verified or not</option>
          <option value="true">Needs verification</option>
          <option value="false">Verified</option>
        </Select>
        {filters.parent_id && (
          <Button variant="ghost" onClick={() => update({ parent_id: "" })}>Clear parent filter</Button>
        )}
      </div>
      {query.isLoading ? (
        <Spinner />
      ) : query.error ? (
        <div className="p-4"><ErrorNote error={query.error} /></div>
      ) : query.data!.items.length === 0 ? (
        <Empty title="No locations match these filters" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>In</Th>
                <Th>Status</Th>
                <Th>Complete</Th>
                <Th>Source</Th>
                <Th className="text-right">Updated</Th>
              </tr>
            </thead>
            <tbody>
              {query.data!.items.map((loc) => (
                <tr key={loc.id} className="hover:bg-surface-2/60">
                  <Td className="max-w-80">
                    <Link href={`/locations/${loc.id}`} className="font-medium hover:text-brand">
                      {loc.name}
                    </Link>
                    {loc.highlight && <Badge tone="brand" className="ml-2">Highlight</Badge>}
                    {loc.summary && <p className="mt-0.5 truncate text-xs text-muted">{loc.summary}</p>}
                  </Td>
                  <Td className="capitalize text-muted">{loc.type}</Td>
                  <Td className="text-muted">
                    {loc.parent ? (
                      <Link href={`/locations/${loc.parent.id}`} className="hover:text-text">{loc.parent.name}</Link>
                    ) : "—"}
                  </Td>
                  <Td><Badge tone={STATUS_TONE[loc.status]}>{loc.status}</Badge></Td>
                  <Td><Completeness value={loc.completeness ?? 1} missing={loc.missing_fields} /></Td>
                  <Td><SourceBadge source={loc.source} provenance={loc.provenance} /></Td>
                  <Td className="whitespace-nowrap text-right text-muted">{relativeTime(loc.updated_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={filters.page}
            pageSize={PAGE_SIZE}
            total={query.data!.total}
            onPage={(page) => update({ page: String(page) })}
          />
        </>
      )}
    </Card>
  );
}

export default function LocationsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Locations"
        description="Every country, city and place in the knowledge base. Only published places reach travelers and the AI."
        action={
          <Link href="/locations/new">
            <Button><Plus className="size-4" /> New location</Button>
          </Link>
        }
      />
      <Suspense fallback={<Spinner />}>
        <LocationsTable />
      </Suspense>
    </div>
  );
}
