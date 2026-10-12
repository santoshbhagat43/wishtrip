import { BedDouble, Plane } from "lucide-react";

/**
 * A part of the trip that belongs in the plan but that we can't fill honestly yet: we have no
 * hotel or flight partners connected, so no names, availability or prices. Shown empty on
 * purpose, so the traveler sees where it will go.
 */
export function BlankSlot({ kind, label }: { kind: "stay" | "flight"; label: string }) {
  const Icon = kind === "stay" ? BedDouble : Plane;
  return (
    <div className="flex items-start gap-3 rounded-xl border-[1.5px] border-dashed border-border bg-surface-2/40 px-3.5 py-3">
      <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {label} <span className="font-normal text-muted">— to be added</span>
        </p>
        <p className="text-xs text-muted">
          {kind === "stay" ? "We'll suggest hotels once our hotel partners are connected." : "Flight options will appear once our airline partners are connected."}
          {" "}Price: <span className="italic">not available yet</span>
        </p>
      </div>
    </div>
  );
}

/** Nights in a trip of `days` days: a hotel slot every day but the last. */
export function needsStay(day: number, lastDay: number) {
  return lastDay > 1 && day < lastDay;
}
