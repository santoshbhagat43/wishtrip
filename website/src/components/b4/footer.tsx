"use client";

import Link from "next/link";

import { b4FooterGroups, useMenus } from "./menus";

type Item = { label: string; url: string; opens_in_new_tab: boolean };

const FALLBACK: Item[] = [
  { label: "Destinations", url: "/destinations", opens_in_new_tab: false },
  { label: "Creator trips", url: "/creators/trips", opens_in_new_tab: false },
  { label: "For creators", url: "/creators", opens_in_new_tab: false },
  { label: "Help", url: "/help", opens_in_new_tab: false },
];

/** The B4 footer: one slim bar, the copyright on the left and a few links on the right. The links
 *  come from the CMS footer menus (every group, each address once), with a minimal fallback. */
export function SiteFooter() {
  const menus = useMenus("footer");
  const seen = new Set<string>();
  const fromMenus = b4FooterGroups(menus.data)
    .flatMap((g) => g.items)
    .filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
  const links = fromMenus.length ? fromMenus : FALLBACK;
  return (
    <footer className="mt-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 self-stretch border-t border-[#E8EEF4] pt-5 text-left text-[12.5px] text-[#5F6B78] md:mt-16">
      <span>© wishtrip · Travel your way</span>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
        {links.map((i) => (
          <Link
            key={i.url}
            href={i.url}
            target={i.opens_in_new_tab ? "_blank" : undefined}
            rel={i.opens_in_new_tab ? "noreferrer" : undefined}
            className="font-medium text-[#0A7C80] underline decoration-[#0A7C80]/40 underline-offset-2 hover:decoration-[#0A7C80]"
          >
            {i.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
