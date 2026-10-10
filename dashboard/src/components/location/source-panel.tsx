"use client";

import { ShieldAlert } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import type { Location } from "@/lib/api/client";
import { titleCase } from "@/lib/format";

function Rows({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return <p className="text-sm text-muted">Nothing recorded.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{titleCase(k)}</dt>
          <dd className="break-words font-mono text-xs leading-5">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SourcePanel({ location }: { location: Location }) {
  return (
    <Card>
      <CardHeader title="Source & provenance" description="Where this record came from and how much to trust it." />
      <div className="space-y-5 p-5">
        <Rows data={{ source: location.source, external_id: location.external_id, ...location.provenance }} />
        {Object.keys(location.reference ?? {}).length > 0 && (
          <div className="rounded-lg border border-warn/30 bg-warn-soft/50 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-warn">
              <ShieldAlert className="size-4" /> Reference data — unverified, staff only
            </p>
            <p className="mb-3 text-xs text-muted">
              Imported estimates (e.g. indicative rates). Never shown to travelers and never given to the AI. To show
              a price, verify it and enter it as the <em>Verified price</em>.
            </p>
            <Rows data={location.reference as Record<string, unknown>} />
          </div>
        )}
      </div>
    </Card>
  );
}
