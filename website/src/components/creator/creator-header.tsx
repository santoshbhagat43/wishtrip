"use client";

import { LogOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { useMe, useSignOut } from "@/lib/session";

function initials(name: string) {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "··";
}

export function CreatorHeader() {
  const { data: me } = useMe();
  const signOut = useSignOut();
  const name = me?.full_name || me?.email || "";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/creator" className="flex items-center gap-3" aria-label="Creator dashboard">
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
          <div className="flex items-center gap-3">
            <span className="hidden text-right sm:block">
              <span className="block text-sm font-semibold leading-tight">{name}</span>
              <span className="block text-xs capitalize text-muted">{me.role}</span>
            </span>
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand"
            >
              {initials(name)}
            </span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
