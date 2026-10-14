"use client";

import Image from "next/image";
import Link from "next/link";

import { LINKS } from "../data";
import { CARD, DonePill, FlowHeader } from "../flow";
import { BOOKED_IMG, BOOKED_ITEMS } from "../flow-data";
import { AryaMark, CHECK, Path } from "../icons";

function Items() {
  return (
    <div className={`${CARD} overflow-hidden rounded-[22px]`}>
      {BOOKED_ITEMS.map((b, i) => (
        <div key={b.title} className={`flex items-center gap-3 px-4 py-[13px] ${i < BOOKED_ITEMS.length - 1 ? "border-b border-[#EDE6DC]" : ""}`}>
          <span className="grid size-[30px] flex-none place-items-center rounded-full bg-[#E3F5EE]">
            <Path d={CHECK} size={14} stroke="#0B7A57" width={2.6} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong className="text-sm md:text-[15px]">{b.title}</strong>
            <span className="text-xs text-[#566E85] md:text-[12.5px]">{b.meta}</span>
          </span>
          <span className="flex flex-col items-end gap-0.5 whitespace-nowrap">
            <span className="text-[12.5px] font-bold tabular-nums tracking-[.02em] text-[#3F5A72]">{b.ref}</span>
            {b.masked && <span className="text-[11px] text-[#8A7F72]">Shown on 6 Dec</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function LockNote() {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-[#F4EFE8] px-3.5 py-3 text-[13.5px] leading-normal text-[#3F5A72]">
      <Path d="M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3" size={16} stroke="#3F5A72" className="mt-0.5 flex-none" />
      <span>
        Airline PNR and hotel confirmation unlock on <strong className="text-[#0D2436]">Fri 6 Dec</strong>, 6 days before you fly. Until then, quote your wishtrip ID{" "}
        <strong className="text-[#0D2436]">WT-GOA-[REF]</strong> for anything.
      </span>
    </div>
  );
}

function Actions() {
  return (
    <span className="flex flex-col gap-2.5 md:flex-row">
      <a href="#" className="rounded-full bg-[#072338] px-[22px] py-3.5 text-center text-[15px] font-semibold text-white no-underline">
        Share with family on WhatsApp
      </a>
      <a href="#" className="rounded-full border-[1.5px] border-[#072338] px-[22px] py-[13px] text-center text-[15px] font-semibold text-[#072338] no-underline">
        Download itinerary (PDF)
      </a>
    </span>
  );
}

function SideCards() {
  return (
    <>
      <div className={`${CARD} flex items-start gap-3 p-4`}>
        <AryaMark size={36} fontSize={19} />
        <span className="flex flex-col gap-1">
          <strong className="text-[15px]">Arya’s looking after it</strong>
          <span className="text-[13.5px] leading-normal text-[#3F5A72]">I’ll do web check-in on 10 Dec and remind you to pay the balance by 2 Dec. Need a change? Just ask.</span>
          <Link href={LINKS.arya} className="text-[13.5px] font-bold text-[#0A7C80] underline">
            Open my trip chat →
          </Link>
        </span>
      </div>
      <div className={`${CARD} flex flex-col gap-1.5 p-4`}>
        <strong className="text-[15px]">Prefer a person?</strong>
        <span className="text-[13.5px] text-[#3F5A72]">Rhea, your trip expert, is on WhatsApp from now until you’re home.</span>
        <a href="#" className="text-[13.5px] font-bold text-[#0B7A57] underline">
          Message Rhea on WhatsApp →
        </a>
      </div>
      <Link href={LINKS.creators} className="flex flex-col gap-1 rounded-[20px] bg-[#072338] p-4 text-white no-underline">
        <span className="text-[11px] font-bold tracking-[.14em] text-[#6BEDEF]">AFTER YOU’RE BACK</span>
        <strong className="text-base">Post your trip and earn from it</strong>
        <span className="text-[13px] text-[#A9C2D4]">Every time someone books your Goa trip, you earn [X%].</span>
      </Link>
    </>
  );
}

/** Done: everything confirmed, what happens next, and who's looking after the trip. */
export function BookedScreen() {
  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader title="Booked" subtitle="Asha’s Goa trip" signedIn nav />

      {/* Phones */}
      <div className="md:hidden">
        <div className="relative h-[200px]">
          <Image src={BOOKED_IMG} alt="Goa beach at sunset" fill sizes="100vw" className="object-cover" priority />
        </div>
        <section className="flex flex-col gap-2.5 px-4 pb-2.5 pt-[18px]">
          <span className="self-start">
            <DonePill size={13}>All booked · WT-GOA-[REF]</DonePill>
          </span>
          <h1 className="font-display m-0 text-[34px] font-medium leading-[1.06]">You’re going to Goa, Asha.</h1>
          <p className="m-0 text-[14.5px] leading-[1.55] text-[#3F5A72]">
            In 67 days · Thu 12 Dec, 8:10 am from Bengaluru. Tickets, vouchers and your day-by-day board are on WhatsApp and email.
          </p>
        </section>
        <section className="flex flex-col gap-3 px-4 pb-10 pt-1.5">
          <Items />
          <LockNote />
          <Actions />
          <div className="mt-2 flex flex-col gap-3">
            <SideCards />
          </div>
        </section>
      </div>

      {/* Desktop */}
      <main className="mx-auto hidden max-w-[1240px] grid-cols-[1fr_360px] items-start gap-9 px-10 pb-[72px] pt-10 md:grid">
        <section className="flex flex-col gap-[18px]">
          <span className="self-start">
            <DonePill size={13}>All booked · WT-GOA-[REF]</DonePill>
          </span>
          <h1 className="font-display m-0 text-[54px] font-medium leading-[1.06]">You’re going to Goa, Asha.</h1>
          <p className="m-0 text-[17px] leading-[1.55] text-[#3F5A72]">
            In 67 days · Thu 12 Dec, 8:10 am from Bengaluru. Tickets, vouchers and your day-by-day board are on WhatsApp and email.
          </p>
          <Items />
          <LockNote />
          <Actions />
        </section>
        <aside className="flex flex-col gap-3.5">
          <div className="relative h-[200px] overflow-hidden rounded-[22px]">
            <Image src={BOOKED_IMG} alt="Goa beach at sunset" fill sizes="360px" className="object-cover" priority />
            <span className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-[rgba(7,35,56,.75)]" />
            <span className="absolute bottom-3.5 left-4 flex flex-col text-white">
              <span className="text-[11px] font-bold tracking-[.14em]">IN 67 DAYS</span>
              <strong className="font-display text-2xl font-medium">Thu 12 Dec · 8:10 am</strong>
            </span>
          </div>
          <SideCards />
        </aside>
      </main>
    </div>
  );
}
