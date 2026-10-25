"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { useMe, useSignOut } from "@/lib/session";

/** Used until staff have configured a header menu, and if the menus call ever fails. */
const FALLBACK = [
  { href: "/explore", label: "Explore" },
  { href: "/arya", label: "Plan a trip" },
  { href: "/saved", label: "Saved" },
  { href: "/help", label: "Help" },
  { href: "/profile", label: "My profile" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const menus = useQuery({
    queryKey: ["menus", "header"],
    queryFn: async () => unwrap(await api.GET("/explore/menus", { params: { query: { placement: "header" } } })),
    staleTime: 5 * 60_000,
  });
  const configured = (menus.data ?? []).flatMap((menu) =>
    menu.items.map((item) => ({ href: item.url, label: item.label })),
  );
  const all = configured.length > 0 ? configured : FALLBACK;
  const help = { href: "/help", label: "Help" };
  const savedAt = all.findIndex((l) => l.href === "/saved");
  const withHelp = all.some((l) => l.href === "/help")
    ? all
    : savedAt === -1
      ? [...all, help]
      : [...all.slice(0, savedAt + 1), help, ...all.slice(savedAt + 1)];
  // Signed out, only the pages that work without an account.
  const links = me ? withHelp : withHelp.filter((l) => l.href === "/explore" || l.href === "/");
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" aria-label="WishTrip home">
          <Image src="/logo.png" alt="WishTrip — Travel your way" width={909} height={351} priority className="h-9 w-auto dark:brightness-0 dark:invert" />
        </Link>
        <nav className={clsx("items-center gap-1", open ? "absolute inset-x-0 top-16 flex flex-col border-b border-border bg-surface p-3 md:static md:flex-row md:border-0 md:p-0" : "hidden md:flex")}>
          {links.map((l) => (
            <Link
              key={`${l.href}-${l.label}`}
              href={l.href}
              onClick={() => setOpen(false)}
              className={clsx(
                "rounded-full px-3.5 py-2 text-sm font-medium",
                pathname.startsWith(l.href) ? "bg-brand-soft text-brand" : "text-muted hover:text-text",
              )}
            >
              {l.label}
            </Link>
          ))}
          {me ? (
            <button onClick={signOut} className="rounded-full px-3.5 py-2 text-sm font-medium text-muted hover:text-text">
              Sign out
            </button>
          ) : (
            <>
              <Link href="/login" onClick={() => setOpen(false)} className="rounded-full px-3.5 py-2 text-sm font-medium text-muted hover:text-text">Sign in</Link>
              <Link href="/signup" onClick={() => setOpen(false)} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong">
                Start planning
              </Link>
            </>
          )}
        </nav>
        <button className="md:hidden" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
    </header>
  );
}
