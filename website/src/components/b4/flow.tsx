"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useState } from "react";

import { IMG, LINKS } from "./data";
import { MenuDrawer, NAV, RoundButton } from "./header";
import { CHECK, MENU, Path } from "./icons";

const STEPS = ["Start", "Shape your board", "Book"];

/** The signed-in traveller's initial, as the prototype shows it in the header. */
function Avatar({ size = 32, letter = "A" }: { size?: number; letter?: string }) {
  return (
    <span
      aria-hidden="true"
      className="font-display grid flex-none place-items-center rounded-full text-white"
      style={{ width: size, height: size, fontSize: size * 0.44, background: "linear-gradient(145deg,#1A6094,#0B3050)" }}
    >
      {letter}
    </span>
  );
}

/**
 * Header for the booking flow. Desktop: logo · step tracker (or the main nav) · Sign in or the
 * traveller · menu. Mobile: back arrow (or logo) · title and subtitle · menu, then progress bars.
 */
export function FlowHeader({
  step,
  title,
  subtitle,
  back,
  signedIn = false,
  traveller,
  nav = false,
}: {
  /** 1–3: which step is current. Omit (with nav) on the booked page. */
  step?: number;
  title: string;
  subtitle: string;
  /** Where the mobile back arrow goes; without it the mobile header shows the logo. */
  back?: string;
  signedIn?: boolean;
  /** The signed-in traveller's name, when we know it (the prototype's demo name otherwise). */
  traveller?: string;
  /** Show the main navigation instead of the step tracker (desktop). */
  nav?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <>
      {/* Desktop */}
      <header className="sticky top-0 z-20 hidden border-b border-[#EDE6DC] bg-[rgba(251,248,244,.96)] md:block">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-5 px-10 py-3.5">
          <Link href={LINKS.home} aria-label="wishtrip home" className="flex">
            <Image src={IMG.logo} alt="wishtrip" width={116} height={32} className="h-8 w-auto" />
          </Link>
          {nav ? (
            <nav aria-label="Main" className="flex gap-1.5 text-[14.5px] font-medium">
              {NAV.map((n) => (
                <Link key={n.label} href={n.href} className="px-3.5 py-2.5 text-[#3F5A72] no-underline hover:text-[#0D2436]">
                  {n.label}
                </Link>
              ))}
            </nav>
          ) : (
            <ol aria-label="Progress" className="m-0 flex list-none items-center gap-2.5 p-0 text-[13px] font-semibold">
              {STEPS.map((label, i) => {
                const n = i + 1;
                const done = step !== undefined && n < step;
                const current = n === step;
                return (
                  <Fragment key={label}>
                    {i > 0 && <li aria-hidden="true" className="h-[1.5px] w-7 bg-[#E3DCD2]" />}
                    <li aria-current={current ? "step" : undefined} className="flex items-center gap-2" style={{ color: done ? "#0B7A57" : current ? "#0D2436" : "#8A7F72" }}>
                      {done ? (
                        <span className="grid size-6 place-items-center rounded-full bg-[#E3F5EE]">
                          <Path d={CHECK} size={13} stroke="#0B7A57" width={2.6} />
                        </span>
                      ) : (
                        <span
                          className={`grid size-6 place-items-center rounded-full text-xs ${current ? "bg-[#072338] text-white" : "border-[1.5px] border-[#D9D0C4]"}`}
                        >
                          {n}
                        </span>
                      )}
                      {label}
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          )}
          <span className="flex items-center gap-3.5">
            {signedIn ? (
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Avatar letter={(traveller ?? "Asha").charAt(0).toUpperCase()} />
                {traveller ?? "Asha"}
              </span>
            ) : (
              <Link href={LINKS.signIn} className="px-1.5 py-2.5 text-[14.5px] font-semibold text-[#0D2436] no-underline">
                Sign in
              </Link>
            )}
            <RoundButton label="Open menu" d={MENU} onClick={() => setMenu(true)} />
          </span>
        </div>
      </header>

      {/* Mobile */}
      <header className="relative z-[5] flex-none border-b border-[#EDE6DC] bg-[#FBF8F4] md:hidden">
        <div className="flex items-center gap-1.5 pb-2 pl-1 pr-3 pt-2.5">
          {back ? (
            <Link href={back} aria-label="Back" className="grid size-11 flex-none place-items-center text-[#0D2436]">
              <Path d="M15 6l-6 6 6 6" size={22} stroke="#0D2436" />
            </Link>
          ) : (
            <Link href={LINKS.home} aria-label="wishtrip home" className="flex pl-2">
              <Image src={IMG.logo} alt="wishtrip" width={95} height={26} className="h-[26px] w-auto" />
            </Link>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <strong className="truncate text-base font-semibold">{title}</strong>
            <span className="text-[11.5px] text-[#8A7F72]">{subtitle}</span>
          </span>
          <RoundButton label="Open menu" d={MENU} onClick={() => setMenu(true)} />
        </div>
        {step !== undefined && (
          <ol aria-label="Progress" className="m-0 grid list-none grid-cols-3 gap-1.5 px-4 pb-3 text-[11.5px] font-semibold">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const done = n < step;
              const current = n === step;
              return (
                <li key={label} aria-current={current ? "step" : undefined} className="flex flex-col gap-[5px]" style={{ color: done ? "#0B7A57" : current ? "#0D2436" : "#8A7F72" }}>
                  <span className="h-1 rounded-full" style={{ background: done ? "#0B7A57" : current ? "#22DDE0" : "#E3DCD2" }} />
                  {label}
                </li>
              );
            })}
          </ol>
        )}
      </header>
      {menu && <MenuDrawer onClose={() => setMenu(false)} />}
    </>
  );
}

/** Small caps label above a block ("WHO'S COMING", "DAY BY DAY"…). */
export function Kicker({ children, teal = false, className = "" }: { children: React.ReactNode; teal?: boolean; className?: string }) {
  return <span className={`text-[11px] font-bold tracking-[.14em] ${teal ? "text-[#0A7C80]" : "text-[#8A7F72]"} ${className}`}>{children}</span>;
}

/** The cyan "why it's on your board" tag. */
export function Why({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 truncate whitespace-nowrap rounded-full bg-[#22DDE0] py-0.5 pl-[7px] pr-[9px] text-[10.5px] font-bold text-[#072338]">
      <Path d="M12 3v4M12 17v4M3 12h4M17 12h4" size={10} stroke="#072338" width={2.6} className="flex-none" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The green "done" pill (✓ Watched the reel, ✓ All booked…). */
export function DonePill({ children, size = 12.5 }: { children: React.ReactNode; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E3F5EE] px-[11px] py-1.5 font-bold text-[#0B7A57]" style={{ fontSize: size }}>
      <Path d={CHECK} size={13} stroke="#0B7A57" width={2.6} />
      {children}
    </span>
  );
}

/** A dark price bar pinned to the bottom of the screen on phones. */
export function MobileBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 rounded-t-[22px] bg-[#072338] px-4 pb-6 pt-3.5 text-white md:hidden">{children}</div>
  );
}

export const CARD = "rounded-[20px] border border-[#E8E1D8] bg-white";
export const SELECTED = "border-2 border-[#072338] shadow-[0_0_0_3px_#DCF8F9]";
export const UNSELECTED = "border-[1.5px] border-[#E3DCD2]";
