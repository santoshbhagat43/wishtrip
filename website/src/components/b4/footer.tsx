"use client";

import Link from "next/link";

import { b4FooterGroups, useMenus } from "./menus";

const FALLBACK = [
  {
    name: "wishtrip",
    slug: "fallback",
    items: [
      { label: "For creators", url: "/creators", opens_in_new_tab: false },
      { label: "Help", url: "/help", opens_in_new_tab: false },
      { label: "Explore", url: "/explore", opens_in_new_tab: false },
    ],
  },
];

/** The B4 footer, driven by the CMS footer menus (falls back to a minimal set). */
export function SiteFooter() {
  const menus = useMenus("footer");
  const groups = b4FooterGroups(menus.data);
  const cols = groups.length ? groups : FALLBACK;
  return (
    <footer className="mt-7 flex flex-col gap-6 self-stretch border-t border-[#E8EEF4] pt-6 text-left md:mt-16">
      <div className="flex flex-wrap gap-x-12 gap-y-6">
        {cols.map((g) => (
          <div key={g.slug} className="flex min-w-[120px] flex-col gap-2">
            <span className="text-[11px] font-bold tracking-[.14em] text-[#8A7F72]">{g.name.toUpperCase()}</span>
            {g.items.map((i) => (
              <Link
                key={i.label}
                href={i.url}
                target={i.opens_in_new_tab ? "_blank" : undefined}
                rel={i.opens_in_new_tab ? "noreferrer" : undefined}
                className="text-[13.5px] text-[#566E85] no-underline hover:text-[#0D2436]"
              >
                {i.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <span className="text-[12.5px] text-[#8A7F72]">© wishtrip · Travel your way</span>
    </footer>
  );
}
