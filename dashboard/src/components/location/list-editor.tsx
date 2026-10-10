"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/** Editable list of short strings (pros, cons, travel styles…). */
export function ListEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  function add() {
    const item = draft.trim();
    if (item && !value.includes(item)) onChange([...value, item]);
    setDraft("");
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((item, i) => (
            <li key={item} className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
              <span>{item}</span>
              <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <X className="size-3.5 text-muted hover:text-danger" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add}>Add</Button>
      </div>
    </div>
  );
}

/** Key/value rows, used for opening hours ({"mon": "9:00–17:00", "source": "…"}). */
export function KeyValueEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const [key, setKey] = useState("");
  const [val, setVal] = useState("");
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 font-medium">{k}</span>
          <Input value={v} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
          <button
            type="button"
            aria-label={`Remove ${k}`}
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
          >
            <X className="size-4 text-muted hover:text-danger" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input className="w-28 shrink-0" placeholder="mon / open_days" value={key} onChange={(e) => setKey(e.target.value)} />
        <Input placeholder="09:00–17:00" value={val} onChange={(e) => setVal(e.target.value)} />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (key.trim()) onChange({ ...value, [key.trim()]: val });
            setKey("");
            setVal("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
