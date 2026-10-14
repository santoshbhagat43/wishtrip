import { BadgeCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = { "goexperience-kb": "Client KB", manual: "Manual" };

export function SourceBadge({ source, provenance }: { source: string; provenance?: Record<string, unknown> }) {
  const needsVerification = provenance?.needs_verification === true;
  const isVerified = !needsVerification && !!provenance?.verified_at;

  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={source === "manual" ? "neutral" : "info"}>{LABELS[source] ?? source}</Badge>
      {needsVerification && <Badge tone="warn">Verify</Badge>}
      {isVerified && (
        <Badge tone="info">
          <BadgeCheck className="size-3.5" aria-hidden />
          Verified
        </Badge>
      )}
    </span>
  );
}
