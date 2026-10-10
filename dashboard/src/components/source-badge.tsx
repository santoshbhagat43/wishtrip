import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = { "goexperience-kb": "Client KB", manual: "Manual" };

export function SourceBadge({ source, provenance }: { source: string; provenance?: Record<string, unknown> }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={source === "manual" ? "neutral" : "info"}>{LABELS[source] ?? source}</Badge>
      {provenance?.needs_verification === true && <Badge tone="warn">Verify</Badge>}
    </span>
  );
}
