"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api, unwrap } from "@/lib/api/client";
import { useMe, useSignOut } from "@/lib/session";

function initials(name: string) {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "··";
}

export function CreatorHeader() {
  const { data: me } = useMe();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  // Their own account: the name and profile photo they chose for their page.
  const creator = useQuery({
    queryKey: ["creator-me"],
    enabled: me?.role === "creator",
    retry: false,
    queryFn: async () => unwrap(await api.GET("/creators/me")),
  });
  const name = creator.data?.display_name || me?.full_name || me?.email || "";

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="Creator dashboard">
          <Image
            src="/logo.png"
            alt="WishTrip"
            width={909}
            height={351}
            priority
            className="h-8 w-auto self-start dark:brightness-0 dark:invert"
          />
          <span className="hidden border-l border-border pl-3 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted sm:inline">
            Creator dashboard
          </span>
        </Link>
        {me && (
          <div ref={menu} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label="Account menu"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-3 rounded-full py-1 pl-3 pr-1.5 hover:bg-surface-2"
            >
              <span className="hidden text-right sm:block">
                <span className="block text-sm font-semibold leading-tight">{name}</span>
                <span className="block text-xs capitalize text-muted">{me.role}</span>
              </span>
              <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-full bg-brand text-[12px] font-bold text-on-brand">
                {creator.data?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- backend media
                  <img src={creator.data.avatar_url} alt="" className="size-full object-cover" />
                ) : (
                  <span aria-hidden>{initials(name)}</span>
                )}
              </span>
              <ChevronDown className={`size-4 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {open && (
              <div
                role="menu"
                aria-label="Account"
                className="absolute right-0 top-[calc(100%+8px)] z-40 flex w-[220px] flex-col overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-[0_14px_40px_rgba(7,35,56,.16)]"
              >
                <span className="px-3 pb-2 pt-1.5 text-xs text-muted">
                  Signed in as
                  <span className="block truncate text-[13px] font-semibold text-text">{me.email}</span>
                </span>
                <Link
                  href="/profile"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-surface-2"
                >
                  <UserRound className="size-4" /> Profile
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={signOut}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-surface-2"
                >
                  <LogOut className="size-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
