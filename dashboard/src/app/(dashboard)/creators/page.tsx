"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, Empty, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { CREATOR_STATUS, rupees } from "@/lib/creators";

export default function CreatorsPage() {
  const creators = useQuery({ queryKey: ["creators"], queryFn: async () => unwrap(await api.GET("/creators")) });
  const rows = creators.data ?? [];
  const total = (key: "credited_travellers" | "trips_planned" | "earned_paise") => rows.reduce((n, c) => n + c.stats[key], 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb="Growth"
        title="Creators"
        description="Everyone whose reels travellers paste, and the affiliates who send us travellers. A creator earns a commission for each traveller they bring in who plans a trip."
        action={
          rows.length > 0 && (
            <HeaderStats
              items={[
                { value: rows.length, label: "creators" },
                { value: total("credited_travellers"), label: "travellers brought in" },
                { value: rupees(total("earned_paise")), label: "earned" },
              ]}
            />
          )
        }
      />
      <Card>
        {creators.isLoading ? (
          <Spinner />
        ) : creators.error ? (
          <div className="p-4">
            <ErrorNote error={creators.error} />
          </div>
        ) : rows.length === 0 ? (
          <Empty title="No creators yet">A creator is saved the first time a traveller pastes one of their reels on the website.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Creator</Th>
                <Th>Status</Th>
                <Th className="text-right">Reels</Th>
                <Th className="text-right">Reel pastes</Th>
                <Th className="text-right">Link visits</Th>
                <Th className="text-right">Travellers</Th>
                <Th className="text-right">Trips planned</Th>
                <Th className="text-right">Earned</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/creators/${c.id}`} className="font-medium hover:text-brand">
                      @{c.handle}
                    </Link>
                    {c.display_name && <p className="text-xs text-muted">{c.display_name}</p>}
                  </Td>
                  <Td>
                    <Badge tone={CREATOR_STATUS[c.status].tone}>{CREATOR_STATUS[c.status].label}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{c.stats.reels}</Td>
                  <Td className="text-right tabular-nums">{c.stats.reel_imports}</Td>
                  <Td className="text-right tabular-nums">{c.stats.link_visits}</Td>
                  <Td className="text-right tabular-nums">{c.stats.credited_travellers}</Td>
                  <Td className="text-right tabular-nums">{c.stats.trips_planned}</Td>
                  <Td className="text-right tabular-nums">{rupees(c.stats.earned_paise)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
