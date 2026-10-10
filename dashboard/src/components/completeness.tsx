import clsx from "clsx";

export function Completeness({ value, missing }: { value: number; missing?: string[] }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" title={missing?.length ? `Missing: ${missing.join(", ")}` : "Complete"}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div
          className={clsx("h-full rounded-full", pct === 100 ? "bg-ok" : pct >= 60 ? "bg-brand" : "bg-warn")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted">{pct}%</span>
    </div>
  );
}
