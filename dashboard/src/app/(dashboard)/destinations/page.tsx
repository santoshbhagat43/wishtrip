"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";

/** A thin bar for "how much of this city is ready", drawn from counts we actually hold. */
function Readiness({ ready, total }: { ready: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((ready / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-xs text-muted">{pct}%</span>
    </div>
  );
}

export default function DestinationsPage() {
  const destinations = useQuery({
    queryKey: ["destinations"],
    queryFn: async () => unwrap(await api.GET("/admin/destinations")),
  });

  if (destinations.isLoading) return <Spinner />;
  if (destinations.error) return <ErrorNote error={destinations.error} />;

  const rows = destinations.data!;
  const totals = rows.reduce(
    (acc, r) => ({ published: acc.published + r.published, draft: acc.draft + r.draft, trips: acc.trips + r.trips }),
    { published: 0, draft: 0, trips: 0 },
  );
  const byCountry = [...new Set(rows.map((r) => r.country).filter(Boolean))];
  // Region demand is shared by a region's cities, so add each region once.
  const regionTrips = [...new Map(rows.map((r) => [r.region, r.region_trips])).values()].reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb="Content"
        title="Destinations"
        description="Every city the engine can plan from, what it holds, and how often travellers ask for it."
        action={
          <HeaderStats
            items={[
              { value: rows.length, label: "cities" },
              { value: byCountry.length, label: "countries" },
              { value: totals.published, label: "published places" },
              { value: totals.trips + regionTrips, label: "trips planned" },
            ]}
          />
        }
      />

      <Card>
        <CardHeader
          title="By demand"
          description="Trips counted from real chat sessions. A region like Kerala is counted once for the region, not against each of its cities."
        />
        <Table>
          <thead>
            <tr>
              <Th>Destination</Th>
              <Th className="text-right">Published</Th>
              <Th className="text-right">Drafts</Th>
              <Th>Indexed</Th>
              <Th className="text-right">Trips</Th>
              <Th className="text-right">Updated</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/locations?parent_id=${row.id}`} className="font-medium text-text hover:text-brand">
                    {row.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {[...new Set([row.region, row.country])].filter((part) => part && part !== row.name).join(" · ") ||
                      "No region set"}
                  </p>
                </Td>
                <Td className="text-right tabular-nums">{row.published}</Td>
                <Td className="text-right tabular-nums">
                  {row.draft > 0 ? <span className="text-warn">{row.draft}</span> : <span className="text-muted">—</span>}
                </Td>
                <Td>
                  <Readiness ready={row.embedded} total={row.published} />
                </Td>
                <Td className="text-right">
                  <span className="tabular-nums">{row.trips}</span>
                  {row.region_trips > 0 && (
                    <Badge tone="brand" className="ml-2">
                      +{row.region_trips} via {row.region}
                    </Badge>
                  )}
                </Td>
                <Td className="text-right text-xs text-muted">{relativeTime(row.updated_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
