"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/field";
import { api, unwrap, type LocationType } from "@/lib/api/client";

export type PickedLocation = { id: string; name: string; type: string; parent?: { name: string } | null };

/** Type-ahead search over the knowledge base. */
export function LocationPicker({
  types,
  excludeId,
  placeholder = "Search locations…",
  onPick,
}: {
  types?: LocationType[];
  excludeId?: string;
  placeholder?: string;
  onPick: (location: PickedLocation) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useQuery({
    queryKey: ["location-picker", q, types],
    enabled: open,
    queryFn: async () =>
      unwrap(await api.GET("/admin/locations", { params: { query: { q: q || undefined, type: types, page_size: 12 } } })),
  });
  return (
    <div className="relative">
      <Input
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {results.data?.items
            .filter((l) => l.id !== excludeId)
            .map((loc) => (
              <li key={loc.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(loc);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span>{loc.name}</span>
                  <span className="shrink-0 text-xs capitalize text-muted">
                    {loc.type}
                    {loc.parent ? ` · ${loc.parent.name}` : ""}
                  </span>
                </button>
              </li>
            ))}
          {results.data?.items.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
        </ul>
      )}
    </div>
  );
}
