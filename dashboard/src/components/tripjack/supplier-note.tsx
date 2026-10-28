import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { Supplier } from "@/lib/tripjack";

/** Where an answer came from: live from TripJack (and how long it took) or our short cache. */
export function SupplierNote({ supplier }: { supplier: Supplier }) {
  const live = supplier.served_from === "tripjack";
  const uat = supplier.environment.startsWith("UAT");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-xs text-muted" data-testid="supplier-note">
      <Badge tone={live ? "ok" : "info"}>{live ? "Live from TripJack" : "From our short cache"}</Badge>
      <Badge tone={uat ? "warn" : "neutral"}>{uat ? "UAT (test prices)" : "Production"}</Badge>
      <span>
        {live ? `TripJack answered in ${supplier.upstream_ms} ms` : `Cached ${supplier.cache?.age_seconds ?? "?"} s ago`} · {supplier.server_ms} ms in all
      </span>
      <Link href={`/tripjack/log?q=${supplier.trace_id}`} className="ml-auto text-brand hover:underline">
        See the request and response ({supplier.trace_id}) →
      </Link>
    </div>
  );
}
