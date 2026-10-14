"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Empty, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { CREATOR_STATUS, rupees } from "@/lib/creators";

type Status = Schemas["CreatorStatus"];
const FILTERS: [label: string, value: Status | "all"][] = [
  ["All", "all"],
  ["Pending", "pending"],
  ["Affiliates", "active"],
  ["Unclaimed", "unclaimed"],
];

export default function CreatorsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Status | "all">("all");
  const creators = useQuery({
    queryKey: ["creators", filter],
    queryFn: async () =>
      unwrap(await api.GET("/creators", { params: { query: filter === "all" ? {} : { status: filter } } })),
  });
  const pending = useQuery({
    queryKey: ["creators", "pending-count"],
    queryFn: async () => unwrap(await api.GET("/creators", { params: { query: { status: "pending" } } })),
  });
  const approve = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.PATCH("/creators/{creator_id}", { params: { path: { creator_id: id } }, body: { status: "active" } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creators"] }),
  });

  const rows = creators.data ?? [];
  const total = (key: "credited_travellers" | "trips_planned" | "earned_paise") => rows.reduce((n, c) => n + c.stats[key], 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb="Growth"
        title="Creators"
        description="Everyone whose reels travellers paste, and the affiliates who send us travellers. Approve creators who sign up, and set what each earns per traveller they bring in."
        action={
          rows.length > 0 && (
            <HeaderStats
              items={[
                { value: total("credited_travellers"), label: "travellers brought in" },
                { value: rupees(total("earned_paise")), label: "earned" },
              ]}
            />
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([label, value]) => {
          const count = value === "pending" ? pending.data?.length ?? 0 : null;
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                filter === value ? "bg-brand text-on-brand" : "border border-border bg-surface text-muted hover:text-text"
              }`}
            >
              {label}
              {count ? <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 text-xs font-semibold text-warn">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <Card>
        {creators.isLoading ? (
          <Spinner />
        ) : creators.error ? (
          <div className="p-4"><ErrorNote error={creators.error} /></div>
        ) : rows.length === 0 ? (
          <Empty title={filter === "pending" ? "No creators waiting" : "No creators yet"}>
            {filter === "pending"
              ? "Creators who sign up on the website appear here for approval."
              : "A creator is saved the first time a traveller pastes one of their reels, or when someone signs up as a creator."}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Creator</Th>
                <Th>Status</Th>
                <Th className="text-right">Reels</Th>
                <Th className="text-right">Travellers</Th>
                <Th className="text-right">Trips</Th>
                <Th className="text-right">Earned</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/creators/${c.id}`} className="font-medium hover:text-brand">
                      {c.handle ? `@${c.handle}` : c.email ?? "New creator"}
                    </Link>
                    {c.display_name && <p className="text-xs text-muted">{c.display_name}</p>}
                    {!c.handle && c.email && <p className="text-xs text-muted">Handle not set yet</p>}
                  </Td>
                  <Td><Badge tone={CREATOR_STATUS[c.status].tone}>{CREATOR_STATUS[c.status].label}</Badge></Td>
                  <Td className="text-right tabular-nums">{c.stats.reels}</Td>
                  <Td className="text-right tabular-nums">{c.stats.credited_travellers}</Td>
                  <Td className="text-right tabular-nums">{c.stats.trips_planned}</Td>
                  <Td className="text-right tabular-nums">{rupees(c.stats.earned_paise)}</Td>
                  <Td className="text-right">
                    {c.status === "pending" && (
                      <Button size="sm" variant="secondary" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>
                        Approve
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
