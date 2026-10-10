"use client";

import clsx from "clsx";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            value === tab.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-text",
          )}
        >
          {tab.label}
          {tab.count != null && <span className="ml-1.5 text-xs text-muted">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
