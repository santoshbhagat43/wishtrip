"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { IMG, LINKS, MENU as MENU_GROUPS } from "./data";
import { ARROW, CLOSE, MENU, Path } from "./icons";
import { HeaderSearch, type SearchEntry } from "./header-search";
import { menuBySlug, useMenus } from "./menus";

export const NAV = [
  { href: "/#b4-arya", label: "How it works" },
  { href: LINKS.destinations, label: "Destinations" },
  { href: "/creators/trips", label: "Creator trips" },
  { href: "/#b4-creators", label: "For creators" },
];

export function RoundButton({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-11 flex-none cursor-pointer place-items-center rounded-full border border-[#E3E8EE] bg-white"
    >
      <Path d={d} size={22} stroke="#0D2436" />
    </button>
  );
}

export function MenuDrawer({ onClose, search, focusSearch = false }: { onClose: () => void; search?: SearchEntry[]; focusSearch?: boolean }) {
  const drawerMenus = useMenus("mobile");
  const drawerLinks =
    menuBySlug(drawerMenus.data, "b4-drawer")?.items ??
    MENU_GROUPS.flatMap((g) => g.items.map((i) => ({ label: i.label, url: i.href, opens_in_new_tab: false })));
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <>
      <button type="button" onClick={onClose} aria-label="Close menu" className="fixed inset-0 z-[80] cursor-pointer border-0 bg-[rgba(7,35,56,.38)]" />
      <nav
        role="dialog"
        aria-label="Menu"
        className="fixed inset-y-0 right-0 z-[90] flex w-full flex-col overflow-y-auto bg-[#FFFFFF] px-4 pb-6 pt-3.5 shadow-[-20px_0_60px_rgba(7,35,56,.2)] md:w-[400px] md:px-[26px] md:pt-[22px]"
      >
        <div className="mb-3.5 flex items-center justify-between">
          <Image src={IMG.logo} alt="wishtrip" width={95} height={26} className="h-[26px] w-auto" />
          <RoundButton label="Close menu" d={CLOSE} onClick={onClose} />
        </div>
        {search && (
          <div className="mb-3.5 md:hidden">
            <HeaderSearch index={search} drawer autoFocus={focusSearch} onNavigate={onClose} />
          </div>
        )}
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-[#E3E8EE] bg-white p-4">
          <strong className="text-base">Sign in to wishtrip</strong>
          <span className="text-[13.5px] leading-[1.45] text-[#566E85]">See your trip boards, saved reels and bookings on any device.</span>
          <span className="flex gap-2">
            <Link href={LINKS.signIn} className="flex-1 rounded-full bg-[#072338] p-3 text-center text-[14.5px] font-semibold text-white no-underline">
              Sign in
            </Link>
            <Link
              href={LINKS.createAccount}
              className="flex-1 rounded-full border-[1.5px] border-[#072338] p-[11px] text-center text-[14.5px] font-semibold text-[#072338] no-underline"
            >
              Create account
            </Link>
          </span>
          <span className="text-xs text-[#5F6B78]">With an emailed code or Google. No passwords.</span>
        </div>
        <div className="flex flex-col">
          <span className="mb-1 mt-3.5 text-[10.5px] font-bold tracking-[.14em] text-[#5F6B78]">MENU</span>
          {drawerLinks.map((item) => (
            <Link
              key={item.label}
              href={item.url}
              target={item.opens_in_new_tab ? "_blank" : undefined}
              rel={item.opens_in_new_tab ? "noreferrer" : undefined}
              onClick={onClose}
              className="flex items-center gap-3 rounded-xl px-1 py-[11px] text-[15.5px] font-medium text-[#0D2436] no-underline"
            >
              <Path d={ARROW} stroke="#0A7C80" width={1.9} className="flex-none" />
              {item.label}
            </Link>
          ))}
        </div>
        <Link
          href={LINKS.creators}
          onClick={onClose}
          className="mt-4 flex items-center gap-3 rounded-2xl bg-[#072338] px-4 py-3.5 text-white no-underline"
        >
          <span className="flex flex-1 flex-col gap-0.5">
            <strong className="text-[15px]">For creators: earn with wishtrip</strong>
            <span className="text-[12.5px] text-[#A9C2D4]">Your trip becomes a source of earning</span>
          </span>
          <span className="font-bold text-[#22DDE0]">→</span>
        </Link>
        <a href="#" className="mt-3.5 text-sm font-semibold text-[#0B7A57]">
          Help on WhatsApp · 9 am to 10 pm
        </a>
      </nav>
    </>
  );
}

/** The top bar of the B4 pages: logo, main links on desktop, Sign in, and the menu drawer. */
export function B4Header({ solid = false, search }: { solid?: boolean; search?: SearchEntry[] }) {
  const [open, setOpen] = useState<false | "menu" | "search">(false);
  const headerMenus = useMenus("header");
  const nav =
    menuBySlug(headerMenus.data, "b4-primary")?.items ??
    NAV.map((n) => ({ label: n.label, url: n.href, opens_in_new_tab: false }));
  return (
    <>
      <header className={`absolute inset-x-0 top-0 z-30 flex h-[60px] items-center justify-between gap-7 px-4 md:h-[76px] md:justify-start md:px-10 ${solid ? "bg-[rgba(255,255,255,0.97)] border-b border-[#E8EDF2] backdrop-blur" : ""}`}>
        <Link href={LINKS.home} aria-label="wishtrip home" className="flex">
          <Image src={IMG.logo} alt="wishtrip" width={138} height={38} priority className="h-[31px] w-auto md:h-[38px]" />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 justify-center gap-1.5 text-[14.5px] font-medium md:flex">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.url}
              target={n.opens_in_new_tab ? "_blank" : undefined}
              rel={n.opens_in_new_tab ? "noreferrer" : undefined}
              className="px-3.5 py-2.5 text-[#3F5A72] no-underline hover:text-[#0D2436]"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        {search && <HeaderSearch index={search} />}
        <Link href={LINKS.signIn} className="hidden px-1.5 py-2.5 text-[14.5px] font-semibold text-[#0D2436] no-underline md:block">
          Sign in
        </Link>
        <span className="flex items-center gap-2">
          {search && (
            <span className="md:hidden">
              <RoundButton label="Search" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" onClick={() => setOpen("search")} />
            </span>
          )}
          <RoundButton label="Open menu" d={MENU} onClick={() => setOpen("menu")} />
        </span>
      </header>
      {open && <MenuDrawer onClose={() => setOpen(false)} search={search} focusSearch={open === "search"} />}
    </>
  );
}
