"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Card, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";

export default function TravelersPage() {
  const [page, setPage] = useState(1);
  const travelers = useQuery({
    queryKey: ["travelers", page],
    queryFn: async () => unwrap(await api.GET("/admin/travelers", { params: { query: { page, page_size: 25 } } })),
  });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Travelers"
        description="Traveler profiles and behavior. Open one to see exactly what they'd be recommended, and why."
      />
      <Card>
        {travelers.isLoading ? (
          <Spinner />
        ) : travelers.error ? (
          <div className="p-4"><ErrorNote error={travelers.error} /></div>
        ) : travelers.data!.items.length === 0 ? (
          <Empty title="No travelers yet">Travelers sign up through the website or app.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Traveler</Th><Th>Travels with</Th><Th>Budget</Th><Th>Energy</Th><Th className="text-right">Signals</Th></tr>
              </thead>
              <tbody>
                {travelers.data!.items.map((t) => (
                  <tr key={t.user_id} className="hover:bg-surface-2/60">
                    <Td>
                      <Link href={`/travelers/${t.user_id}`} className="font-medium hover:text-brand">{t.full_name || t.email}</Link>
                      <p className="text-xs text-muted">{t.email}</p>
                    </Td>
                    <Td className="capitalize text-muted">{t.profile?.companions ?? "—"}</Td>
                    <Td className="text-muted">{t.profile?.budget_level ?? "—"}</Td>
                    <Td className="text-muted">{t.profile?.energy_level ?? "—"}</Td>
                    <Td className="text-right tabular-nums text-muted">{t.event_count}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={travelers.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
