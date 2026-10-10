"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { api, unwrap, type LocationType } from "@/lib/api/client";
import { PLACE_TYPES, titleCase } from "@/lib/format";

export default function SearchPage() {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const results = useQuery({
    queryKey: ["semantic", q, type],
    enabled: q.length >= 2,
    queryFn: async () =>
      unwrap(
        await api.GET("/search/semantic", {
          params: { query: { q, type: type ? [type as LocationType] : undefined, limit: 20 } },
        }),
      ),
  });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Semantic search"
        description="Search by meaning, the same way the chat retrieves knowledge. Useful for checking what the AI will find."
      />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input className="pl-8" placeholder="quiet sunset spot for a couple" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All place types</option>
          {PLACE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
      </form>
      <Card>
        {!q ? (
          <Empty title="Type a query to search the knowledge base" />
        ) : results.isLoading ? (
          <Spinner label="Searching…" />
        ) : results.error ? (
          <div className="p-4"><ErrorNote error={results.error} /></div>
        ) : results.data!.results.length === 0 ? (
          <Empty title="Nothing indexed matches that yet" />
        ) : (
          <>
            <p className="border-b border-border px-5 py-2.5 text-xs text-muted">Embeddings: {results.data!.embedder}</p>
            <ul className="divide-y divide-border">
              {results.data!.results.map(({ location, similarity }) => (
                <li key={location.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/locations/${location.id}`} className="font-medium hover:text-brand">{location.name}</Link>
                    <span className="ml-2 text-xs capitalize text-muted">{location.type}{location.parent ? ` · ${location.parent.name}` : ""}</span>
                    {location.summary && <p className="mt-0.5 text-sm text-muted">{location.summary}</p>}
                  </div>
                  <Badge tone={similarity > 0.6 ? "ok" : similarity > 0.3 ? "brand" : "neutral"}>{similarity.toFixed(2)}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
