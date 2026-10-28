"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useMe, useSignOut } from "@/lib/session";

import { LINKS } from "./data";
import { Path } from "./icons";
import { Avatar } from "./traveller";

/** Where a signed-in traveller goes from their account menu. */
export const ACCOUNT_LINKS = [
  { href: "/profile", label: "My profile", note: "How you like to travel" },
  { href: LINKS.bookings, label: "My bookings", note: "Booked trips and history" },
  { href: "/saved", label: "Saved", note: "Places and reels you kept" },
  { href: LINKS.start, label: "Plan with Arya", note: "Your chats and trip boards" },
  { href: "/help", label: "Help", note: "Questions and support" },
] as const;

/** The signed-in traveller's initial, name and email: the top of the menu. */
function Who() {
  const { data: me } = useMe();
  const name = me?.full_name || me?.email.split("@")[0] || "Traveller";
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar size={40} letter={name.charAt(0).toUpperCase()} />
      <span className="flex min-w-0 flex-col leading-tight">
        <strong className="truncate text-[14.5px] text-[#0D2436]">{name}</strong>
        <span className="truncate text-[12.5px] text-[#566E85]">{me?.email}</span>
      </span>
    </span>
  );
}

/** The account links and Sign out, shared by the dropdown and the mobile drawer. */
export function AccountLinks({ onNavigate }: { onNavigate?: () => void }) {
  const signOut = useSignOut();
  return (
    <>
      {ACCOUNT_LINKS.map((l) => (
        <Link
          key={l.label}
          href={l.href}
          role="menuitem"
          onClick={onNavigate}
          className="flex flex-col rounded-xl px-3 py-2 text-[#0D2436] no-underline hover:bg-[#F2F6F9]"
        >
          <span className="text-[14.5px] font-semibold">{l.label}</span>
          <span className="text-[12px] text-[#566E85]">{l.note}</span>
        </Link>
      ))}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onNavigate?.();
          void signOut();
        }}
        className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-[14.5px] font-semibold text-[#B42318] hover:bg-[#FEF3F2]"
      >
        Sign out
      </button>
    </>
  );
}

/** The signed-in traveller in the header: click for their account menu (profile, bookings, sign out). */
export function AccountMenu({ name }: { name?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const shown = name ?? "Traveller";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-2 rounded-full border-0 bg-transparent py-1 pl-1 pr-2 text-[14.5px] font-semibold text-[#0D2436] hover:bg-[#F2F6F9]"
      >
        <Avatar letter={shown.charAt(0).toUpperCase()} />
        {shown}
        <Path d="M6 9l6 6 6-6" size={16} stroke="#0D2436" width={2} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-[280px] flex-col rounded-2xl border border-[#E3E8EE] bg-white p-2 shadow-[0_18px_50px_rgba(7,35,56,.18)]"
        >
          <div className="mb-1 border-b border-[#E8EDF2] px-3 pb-3 pt-2">
            <Who />
          </div>
          <AccountLinks onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** The same account block for the mobile drawer. */
export function AccountPanel({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-[18px] border border-[#E3E8EE] bg-white p-3">
      <div className="px-3 pb-2 pt-1">
        <Who />
      </div>
      <AccountLinks onNavigate={onNavigate} />
    </div>
  );
}
