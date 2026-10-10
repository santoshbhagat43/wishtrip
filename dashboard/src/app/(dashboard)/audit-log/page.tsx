"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";

const ACTION_TONE = { create: "ok", update: "info", delete: "danger" } as const;

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState("");
  const log = useQuery({
    queryKey: ["audit", page, entity],
    queryFn: async () =>
      unwrap(await api.GET("/admin/audit-log", { params: { query: { page, page_size: 50, entity_type: entity || undefined } } })),
  });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Audit log"
        description="Every change to the knowledge base and users: who, what and when."
        action={
          <Select className="w-auto" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entity">
            <option value="">All entities</option>
            {["location", "relation", "tag", "media", "user"].map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        }
      />
      <Card>
        {log.isLoading ? <Spinner /> : log.error ? <div className="p-4"><ErrorNote error={log.error} /></div> : (
          <>
            <Table>
              <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Changes</Th></tr></thead>
              <tbody>
                {log.data!.items.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-muted">{relativeTime(entry.created_at)}</Td>
                    <Td>{entry.user_email}</Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={ACTION_TONE[entry.action as keyof typeof ACTION_TONE] ?? "neutral"}>{entry.action}</Badge>{" "}
                      {entry.entity_type === "location" && entry.entity_id && entry.action !== "delete" ? (
                        <Link href={`/locations/${entry.entity_id}`} className="text-brand">{entry.entity_type}</Link>
                      ) : (
                        <span className="text-muted">{entry.entity_type}</span>
                      )}
                    </Td>
                    <Td>
                      <code className="line-clamp-2 break-all font-mono text-xs text-muted">{JSON.stringify(entry.changes)}</code>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={50} total={log.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
