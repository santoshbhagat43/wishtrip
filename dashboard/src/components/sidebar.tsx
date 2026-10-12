"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity,
  FolderTree,
  LifeBuoy,
  Link2,
  Globe2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  MessageSquare,
  ScrollText,
  Search,
  ShieldCheck,
  Tags,
  UserCog,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { api, unwrap } from "@/lib/api/client";
import { useMe } from "@/lib/hooks/use-me";

type Item = {
  href: string;
  label: string;
  icon: typeof MapPin;
  adminOnly?: boolean;
  badge?: "review" | "support";
};

const NAV: { section: string; items: Item[] }[] = [
  { section: "Knowledge", items: [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/destinations", label: "Destinations", icon: Globe2 },
    { href: "/locations", label: "Locations", icon: MapPin },
    { href: "/hierarchy", label: "Hierarchy", icon: FolderTree },
    { href: "/tags", label: "Tags", icon: Tags },
    { href: "/review", label: "Review queue", icon: ListChecks, badge: "review" },
    { href: "/menus", label: "Menus", icon: Link2 },
  ]},
  { section: "Intelligence", items: [
    { href: "/chat", label: "Trip chat", icon: MessageSquare },
    { href: "/search", label: "Semantic search", icon: Search },
    { href: "/travelers", label: "Travelers", icon: Users },
    { href: "/support", label: "Support inbox", icon: LifeBuoy, badge: "support" },
  ]},
  { section: "Admin", items: [
    { href: "/users", label: "Staff users", icon: UserCog, adminOnly: true },
    { href: "/roles", label: "Roles & permissions", icon: ShieldCheck },
    { href: "/system", label: "System health", icon: Activity },
    { href: "/audit-log", label: "Audit log", icon: ScrollText },
  ]},
];

const ROLE_LABEL: Record<string, string> = { admin: "Super admin", editor: "Content editor", traveler: "Traveller" };

function initials(name?: string) {
  if (!name) return "··";
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || name.slice(0, 2).toUpperCase();
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();

  // One cheap call keeps the review badge honest across every screen.
  const review = useQuery({
    queryKey: ["review-queue", "badge"],
    queryFn: async () => unwrap(await api.GET("/admin/review-queue", { params: { query: { page_size: 1 } } })),
    staleTime: 60_000,
  });
  const waiting = review.data ? review.data.counts.unverified + review.data.counts.draft : 0;

  // Urgent tickets are the only badge worth interrupting someone for.
  const support = useQuery({
    queryKey: ["support-inbox", "badge"],
    queryFn: async () => unwrap(await api.GET("/admin/support/inbox", { params: { query: { page_size: 1 } } })),
    staleTime: 60_000,
  });
  const urgent = support.data?.counts.urgent ?? 0;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <nav className="flex h-full flex-col gap-[22px] overflow-y-auto px-4 py-6">
      <Link href="/" className="flex px-2" onClick={onNavigate}>
        {/* self-start, or the flex container stretches the image and distorts the logo. */}
        <Image
          src="/logo.png"
          alt="WishTrip"
          width={909}
          height={351}
          priority
          className="h-[34px] w-auto self-start dark:brightness-0 dark:invert"
        />
      </Link>
      <div className="flex flex-col gap-[18px]">
        {NAV.map((group) => (
          <div key={group.section} className="flex flex-col gap-0.5">
            <p className="px-3.5 pb-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted/80">{group.section}</p>
            {group.items
              .filter((item) => !item.adminOnly || me?.role === "admin")
              .map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const count = item.badge === "review" ? waiting : item.badge === "support" ? urgent : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-label={count > 0 ? `${item.label}, ${count} waiting` : undefined}
                    className={clsx(
                      "flex min-h-[42px] items-center gap-3 rounded-full px-3.5 text-sm transition-colors duration-150",
                      active ? "bg-brand-soft font-bold text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <item.icon className="size-[18px] shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 && (
                      <span
                        aria-hidden
                        className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-bold tabular-nums text-warn"
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
          </div>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <span
            aria-hidden
            className="flex size-[38px] flex-none items-center justify-center rounded-full bg-brand text-[13px] font-bold text-on-brand"
          >
            {initials(me?.full_name || me?.email)}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold">{me?.full_name || me?.email}</span>
            <span className="text-[12.5px] capitalize text-muted">{ROLE_LABEL[me?.role ?? ""] ?? me?.role}</span>
          </div>
        </div>
        <button onClick={logout} className="flex items-center gap-2 px-3.5 py-1 text-sm text-muted hover:text-text">
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </nav>
  );
}
