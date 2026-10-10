"use client";

import clsx from "clsx";
import {
  FolderTree,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageSquare,
  ScrollText,
  Search,
  Tags,
  UserCog,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useMe } from "@/lib/hooks/use-me";

const NAV = [
  { section: "Knowledge", items: [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/locations", label: "Locations", icon: MapPin },
    { href: "/hierarchy", label: "Hierarchy", icon: FolderTree },
    { href: "/tags", label: "Tags", icon: Tags },
  ]},
  { section: "Intelligence", items: [
    { href: "/chat", label: "Trip chat", icon: MessageSquare },
    { href: "/search", label: "Semantic search", icon: Search },
    { href: "/travelers", label: "Travelers", icon: Users },
  ]},
  { section: "Admin", items: [
    { href: "/users", label: "Staff users", icon: UserCog, adminOnly: true },
    { href: "/audit-log", label: "Audit log", icon: ScrollText },
  ]},
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <nav className="flex h-full flex-col gap-6 px-3 py-5">
      <Link href="/" className="flex flex-col gap-1 px-2" onClick={onNavigate}>
        <Image src="/logo.png" alt="WishTrip" width={909} height={351} priority className="h-8 w-auto dark:brightness-0 dark:invert" />
        <span className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-accent-text">Knowledge studio</span>
      </Link>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{group.section}</p>
            {group.items
              .filter((item) => !("adminOnly" in item) || me?.role === "admin")
              .map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={clsx(
                      "flex items-center gap-2.5 rounded-full px-3 py-1.5 text-sm transition-colors duration-150",
                      active ? "bg-brand-soft font-semibold text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
          </div>
        ))}
      </div>
      <div className="border-t border-border px-2 pt-4">
        <p className="truncate text-sm font-medium">{me?.full_name || me?.email}</p>
        <p className="text-xs capitalize text-muted">{me?.role}</p>
        <button onClick={logout} className="mt-3 flex items-center gap-2 text-sm text-muted hover:text-text">
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </nav>
  );
}
