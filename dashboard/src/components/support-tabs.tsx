"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Inbox and Routing are two views of the same job, so they share a sub-nav. */
export function SupportTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/support", label: "Inbox" },
    { href: "/support/routing", label: "Routing" },
  ];
  return (
    <div className="flex gap-1 self-start rounded-full bg-surface-2 p-1">
      {tabs.map((tab) => {
        const active = tab.href === "/support" ? pathname === "/support" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-[38px] items-center rounded-full px-4 text-[13px] font-bold no-underline transition-colors ${
              active ? "bg-surface text-brand shadow-card" : "text-muted hover:text-text"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
