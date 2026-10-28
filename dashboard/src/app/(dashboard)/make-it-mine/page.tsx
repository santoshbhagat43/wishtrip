"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";
import { useMe } from "@/lib/hooks/use-me";

export default function MakeItMinePage() {
  const { data: me } = useMe();
  const allowed = me?.role === "admin" || me?.role === "editor";
  const q = useQuery({
    queryKey: ["mine-trips"],
    enabled: allowed,
    refetchInterval: 15000,
    queryFn: async () => unwrap(await api.GET("/admin/mine-trips", { params: { query: { limit: 200 } } })),
  });
  if (!me) return <Spinner />;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Made their own" description="Only admins and editors can see this." />
        <ErrorNote error="Only admins and editors can see this." />
      </div>
    );
  }
  const s = q.data;
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Made their own"
        description="Every trip a traveller made their own with Make it mine: the itinerary it came from, what they chose, and whether they went on to chat with Arya."
      />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorNote error={q.error} />}
      {s && (
        <>
          <HeaderStats
            items={[
              { label: "Trips made", value: s.total },
              { label: "From creator trips", value: s.from_creator_trips },
              { label: "From a pasted reel", value: s.from_own_reels },
              { label: "Chatted with Arya", value: s.talked_to_arya },
            ]}
          />
          <Card>
            <CardHeader title="Most chosen itineraries" description="Which creator trips travellers pick to make their own." />
            <Table>
              <thead><tr><Th>Itinerary</Th><Th>Creator</Th><Th>Destination</Th><Th>Made</Th><Th>Last</Th></tr></thead>
              <tbody>
                {s.top_sources.map((t, i) => (
                  <tr key={`${t.source_share_code}-${i}`}>
                    <Td className="font-medium">{t.source_share_code ? t.source : "A reel they pasted"}</Td>
                    <Td className="text-muted">{t.creator ? `@${t.creator}` : "—"}</Td>
                    <Td>{t.destination || "—"}</Td>
                    <Td className="tabular-nums">{t.made}</Td>
                    <Td className="whitespace-nowrap text-muted">{relativeTime(t.last_made)}</Td>
                  </tr>
                ))}
                {!s.top_sources.length && <tr><td colSpan={5} className="px-4 py-3 text-muted">Nothing yet.</td></tr>}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Trips made" description="Newest first. The trip number is the ID saved with their choices." />
            <Table>
              <thead>
                <tr><Th>Trip no.</Th><Th>Made from</Th><Th>Who · days · pace</Th><Th>When</Th><Th>Status</Th><Th>Arya chats</Th><Th>Made</Th></tr>
              </thead>
              <tbody>
                {s.items.map((t) => (
                  <tr key={t.code}>
                    <Td className="whitespace-nowrap font-mono text-xs uppercase">{`${t.code.slice(0, 4)}-${t.code.slice(4)}`}</Td>
                    <Td>
                      <div className="font-medium">{t.source}</div>
                      <div className="text-xs text-muted">{[t.destination, t.creator && `@${t.creator}`, `${t.stops} stops`].filter(Boolean).join(" · ")}</div>
                    </Td>
                    <Td className="text-sm">
                      {t.party}
                      <div className="text-xs text-muted">{t.days} days · {titleCase(t.pace)}{t.group ? ` · ${titleCase(t.group)}` : ""}</div>
                    </Td>
                    <Td className="text-muted">{t.when || "—"}</Td>
                    <Td>
                      <Badge tone={t.build_status === "ready" ? "ok" : t.build_status === "failed" ? "danger" : "info"}>{t.build_status}</Badge>
                      <div className="text-xs text-muted">{t.ai_built ? "Planned by AI" : "Arranged by rule"}</div>
                    </Td>
                    <Td className="tabular-nums">{t.arya_chats || "—"}</Td>
                    <Td className="whitespace-nowrap text-muted">{relativeTime(t.created_at)}</Td>
                  </tr>
                ))}
                {!s.items.length && <tr><td colSpan={7} className="px-4 py-3 text-muted">No traveller has made a trip their own yet.</td></tr>}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
