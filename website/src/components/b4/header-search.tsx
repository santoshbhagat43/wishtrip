"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Path } from "./icons";

/** One thing the search can find: a place, a creator or a creator's trip. */
export type SearchEntry = {
  group: "Places" | "Creators" | "Trips";
  title: string;
  sub: string;
  href: string;
  /** Lower-case words that should find it. */
  keys: string;
  image?: string | null;
};

const SEARCH = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4";
const GROUPS: SearchEntry["group"][] = ["Places", "Creators", "Trips"];
const PER_GROUP = 4;

function find(index: SearchEntry[], query: string): SearchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = index.filter((e) => words.every((w) => e.keys.includes(w)));
  const starts = (e: SearchEntry) => (e.title.toLowerCase().replace(/^@/, "").startsWith(words[0].replace(/^@/, "")) ? 0 : 1);
  const out: SearchEntry[] = [];
  for (const group of GROUPS) {
    out.push(...hits.filter((e) => e.group === group).sort((a, b) => starts(a) - starts(b)).slice(0, PER_GROUP));
  }
  return out;
}

/** The home page's search: places, creators and trips we really have, found as you type. */
export function HeaderSearch({ index, drawer = false, autoFocus = false, onNavigate }: { index: SearchEntry[]; drawer?: boolean; autoFocus?: boolean; onNavigate?: () => void }) {
  const router = useRouter();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const results = useMemo(() => find(index, q), [index, q]);
  const showing = open && q.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const go = (entry: SearchEntry) => {
    setOpen(false);
    setQ("");
    onNavigate?.();
    router.push(entry.href);
  };

  return (
    <div ref={box} className={drawer ? "relative w-full" : "relative hidden w-[280px] md:block"}>
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#566E85]">
        <Path d={SEARCH} size={17} />
      </span>
      <input
        role="combobox"
        aria-expanded={showing}
        aria-controls={`${id}-list`}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        aria-label="Search places, creators, trips"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Search places, creators, trips"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter" && results[active >= 0 ? active : 0]) {
            e.preventDefault();
            go(results[active >= 0 ? active : 0]);
          }
        }}
        className="h-11 w-full rounded-full border border-[#E3E8EE] bg-white pl-11 pr-4 text-[14.5px] text-[#0D2436] outline-none placeholder:text-[#7C90A3] focus:border-[#0A7C80]"
      />
      {showing && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Search results"
          className={`z-50 flex max-h-[420px] flex-col overflow-y-auto rounded-2xl border border-[#E3E8EE] bg-white p-2 text-left shadow-[0_20px_50px_rgba(7,35,56,.18)] ${
            drawer ? "mt-2" : "absolute right-0 top-[calc(100%+8px)] w-[360px]"
          }`}
        >
          {results.length === 0 ? (
            <p className="m-0 px-3 py-4 text-[14px] text-[#566E85]">Nothing matches “{q.trim()}”. Try a place or a creator&rsquo;s name.</p>
          ) : (
            GROUPS.map((group) => {
              const rows = results.filter((r) => r.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group} className="flex flex-col">
                  <span className="px-3 pb-1 pt-2 text-[11px] font-bold tracking-[.12em] text-[#566E85]">{group.toUpperCase()}</span>
                  {rows.map((r) => {
                    const i = results.indexOf(r);
                    return (
                      <Link
                        key={r.href + r.title}
                        id={`${id}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        href={r.href}
                        onClick={() => {
                          setOpen(false);
                          setQ("");
                          onNavigate?.();
                        }}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 no-underline hover:bg-[#F3F6F9] ${i === active ? "bg-[#F3F6F9]" : ""}`}
                      >
                        <span className={`size-9 flex-none overflow-hidden bg-gradient-to-br from-[#072338] to-[#0A7C80] ${group === "Creators" ? "rounded-full" : "rounded-[10px]"}`}>
                          {r.image && (
                            // eslint-disable-next-line @next/next/no-img-element -- backend media
                            <img src={r.image} alt="" className="size-full object-cover" />
                          )}
                        </span>
                        <span className="flex min-w-0 flex-col leading-tight">
                          <strong className="truncate text-[14px] text-[#0D2436]">{r.title}</strong>
                          <span className="truncate text-[12.5px] text-[#566E85]">{r.sub}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
