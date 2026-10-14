"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, SELECTED, UNSELECTED } from "../flow";
import { BASE_TOTAL, CHECKOUT_IMG, GO_OPTIONS, REFUNDABLE_EXTRA, SAVED_TRAVELLERS, checkoutLines, inr, type GoOption } from "../flow-data";
import { Path } from "../icons";

const INPUT = "rounded-[11px] border-[1.5px] border-[#E3DCD2] p-3 text-base font-medium tracking-normal text-[#0D2436] outline-none focus:border-[#0A7C80]";
const LABEL = "flex flex-col gap-1.5 text-[10.5px] font-bold tracking-[.14em] text-[#8A7F72]";

/** Step 3: who's travelling, how to go ahead, and the all-in summary. */
export function CheckoutScreen() {
  const [opt, setOpt] = useState<GoOption>("book");
  const [plan, setPlan] = useState<"full" | "part">("part");
  const [refund, setRefund] = useState(false);
  const [mumName, setMumName] = useState("");
  const [mumDob, setMumDob] = useState("");
  const [done, setDone] = useState(false);

  const total = BASE_TOTAL + (refund ? REFUNDABLE_EXTRA : 0);
  const ready = mumName.trim().length > 1 && mumDob.trim().length >= 8;
  const payNow = plan === "full" ? total : total / 4;
  const canGo = (opt === "human" || ready) && !done;
  const cta = opt === "book" ? `Pay ${inr(payNow)} and book everything` : opt === "hold" ? "Pay ₹5,000 and hold for 72 hours" : "Request a call back";
  const doneText =
    opt === "hold"
      ? "Held. Prices locked until Sun 11 Oct, 11:40 am. Arya will remind you on WhatsApp a day before."
      : "Done. Rhea, your trip expert, will call you within 10 minutes. She can see your whole board.";

  const travellers = (
    <>
      {SAVED_TRAVELLERS.map((t) => (
        <div key={t.name} className={`${CARD} flex items-center gap-3 rounded-2xl px-3.5 py-[11px]`}>
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full text-[13px] font-bold text-white" style={{ background: "linear-gradient(145deg,#1A6094,#0B3050)" }}>
            {t.i}
          </span>
          <span className="flex flex-1 flex-col">
            <strong className="text-[14.5px] font-semibold">{t.name}</strong>
            <span className="text-xs text-[#566E85]">{t.meta}</span>
          </span>
          <span className="rounded-[7px] bg-[#E3F5EE] px-2 py-1 text-[10px] font-bold tracking-[.11em] text-[#0B7A57]">READY</span>
        </div>
      ))}
      <div className="flex flex-col gap-2.5 rounded-2xl border-[1.5px] bg-white p-3.5" style={{ borderColor: ready ? "#E8E1D8" : "#B8362A" }}>
        <span className="flex items-center justify-between">
          <strong className="text-[14.5px] font-semibold">Mum · senior</strong>
          <span
            className="rounded-[7px] px-2 py-1 text-[10px] font-bold tracking-[.11em]"
            style={{ color: ready ? "#0B7A57" : "#B8362A", background: ready ? "#E3F5EE" : "#FBE9E6" }}
          >
            {ready ? "READY" : "NEEDED"}
          </span>
        </span>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          <label className={LABEL}>
            FULL NAME (AS ON ID)
            <input value={mumName} onChange={(e) => setMumName(e.target.value)} placeholder="e.g. Meena Sharma" className={INPUT} />
          </label>
          <label className={LABEL}>
            DATE OF BIRTH
            <input value={mumDob} onChange={(e) => setMumDob(e.target.value)} placeholder="DD / MM / YYYY" className={INPUT} />
          </label>
        </div>
        {!ready && <span className="text-[12.5px] font-semibold text-[#B8362A]">Airlines need these exactly as on her ID.</span>}
      </div>
    </>
  );

  const goAhead = (
    <div className="flex flex-col gap-2.5">
      <h2 className="m-0 text-[17px] font-bold">How do you want to go ahead?</h2>
      <div role="radiogroup" aria-label="How do you want to go ahead?" className="flex flex-col gap-2">
        {GO_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={opt === o.id}
            onClick={() => {
              setOpt(o.id);
              setDone(false);
            }}
            className={`flex cursor-pointer items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left text-[#0D2436] ${opt === o.id ? SELECTED : UNSELECTED}`}
          >
            <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-xl" style={{ background: o.tint }}>
              <Path d={o.icon} size={19} stroke={o.col} />
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <strong className="text-[15px]">{o.title}</strong>
              <span className="text-[12.5px] text-[#566E85]">{o.sub}</span>
            </span>
            <span
              aria-hidden="true"
              className="size-5 flex-none rounded-full"
              style={{ border: opt === o.id ? "6px solid #072338" : "2px solid #C9C0B4" }}
            />
          </button>
        ))}
      </div>
      {opt === "book" && (
        <div role="radiogroup" aria-label="Payment plan" className="grid grid-cols-2 gap-2 pl-1">
          {(
            [
              ["full", "Pay in full", `${inr(total)} today`],
              ["part", "Pay 25% now", `${inr(total / 4)} today, rest by 2 Dec`],
            ] as const
          ).map(([id, title, meta]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={plan === id}
              onClick={() => setPlan(id)}
              className={`min-h-[50px] cursor-pointer rounded-xl bg-white px-3 py-[9px] text-left text-[#0D2436] ${
                plan === id ? "border-2 border-[#072338]" : UNSELECTED
              }`}
            >
              <span className="block text-[13.5px] font-semibold">{title}</span>
              <span className="block text-xs tabular-nums text-[#566E85]">{meta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const summary = (
    <div className={`${CARD} overflow-hidden rounded-[22px]`}>
      <div className="relative h-[110px] md:h-[130px]">
        <Image src={CHECKOUT_IMG} alt="" fill sizes="420px" className="object-cover" />
        <span className="absolute inset-0 bg-gradient-to-b from-transparent to-[rgba(7,35,56,.75)]" />
        <span className="absolute bottom-3 left-4 flex flex-col text-white">
          <strong className="font-display text-[22px] font-medium">Asha’s Goa trip</strong>
          <span className="text-[12.5px]">Thu 12 – Mon 16 Dec · 3 travellers · from BLR</span>
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-[18px] pb-[18px] pt-4">
        {checkoutLines(refund).map((l) => (
          <span key={l.k} className="flex justify-between gap-3 text-[13.5px]">
            <span className="flex flex-col gap-px">
              <span className="font-semibold">{l.k}</span>
              <span className="text-xs text-[#566E85]">{l.meta}</span>
            </span>
            <span className="num whitespace-nowrap font-semibold!">{l.v}</span>
          </span>
        ))}
        <span className="flex items-baseline justify-between border-t border-[#EDE6DC] pt-3">
          <strong className="text-[15px]">Total, all-in</strong>
          <strong className="num text-[30px]">{inr(total)}</strong>
        </span>
        <div
          aria-live="polite"
          className={`rounded-xl px-3 py-2.5 text-[13px] ${refund ? "bg-[#E3F5EE] font-semibold text-[#0B7A57]" : "bg-[#F4EFE8] text-[#3F5A72]"}`}
        >
          <span className="block">
            {refund ? "Refundable fares on flights and stay. Full refund up to 7 days before you fly." : "Non-refundable fares, the lowest price. No refund if you cancel."}
          </span>
          <button
            type="button"
            onClick={() => setRefund(!refund)}
            className={`cursor-pointer border-0 bg-transparent px-0 pb-0 pt-1.5 text-[13px] font-bold underline underline-offset-[3px] ${refund ? "text-[#3F5A72]" : "text-[#0B7A57]"}`}
          >
            {refund ? "Back to non-refundable · −₹6,900" : "View refundable fares · +₹6,900"}
          </button>
        </div>
        {canGo &&
          (opt === "book" ? (
            <Link href={LINKS.bookings} className="block rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline">
              {cta}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setDone(true)}
              className="w-full cursor-pointer rounded-full border-0 bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338]"
            >
              {cta}
            </button>
          ))}
        {!canGo && !done && (
          <button type="button" disabled className="w-full rounded-full border-0 bg-[#E3DCD2] p-[15px] text-base font-bold text-[#566E85]">
            Add Mum’s name and date of birth
          </button>
        )}
        {done && (
          <div role="status" className="rounded-[14px] bg-[#E3F5EE] px-3.5 py-3 text-sm font-semibold leading-[1.45] text-[#0B7A57]">
            {doneText}
          </div>
        )}
        <span className="text-center text-xs text-[#566E85]">UPI, cards and net banking · secure payment</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader step={3} title="Book it in one go" subtitle="Asha’s Goa trip" back={LINKS.board} signedIn />

      {/* Phones */}
      <div className="flex flex-col gap-6 px-4 pb-10 pt-4 md:hidden">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-[17px] font-bold">Who’s travelling</h2>
            <span className="text-xs text-[#566E85]">Signed in · details saved</span>
          </div>
          {travellers}
        </div>
        {goAhead}
        {summary}
      </div>

      {/* Desktop */}
      <main className="mx-auto hidden max-w-[1240px] grid-cols-[1fr_420px] items-start gap-9 px-10 pb-[72px] pt-9 md:grid">
        <section className="flex flex-col gap-6">
          <div>
            <Kicker teal>BOOK IT IN ONE GO</Kicker>
            <h1 className="font-display mb-0 mt-1.5 text-[44px] font-medium leading-[1.08]">Almost there, Asha</h1>
            <p className="mb-0 mt-2 text-[15.5px] text-[#3F5A72]">
              Your details are saved. Add Mum’s, choose how you want to go ahead, and we book every piece together.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            <h2 className="m-0 text-[17px] font-bold">Who’s travelling</h2>
            {travellers}
          </div>
          {goAhead}
        </section>
        <aside className="sticky top-[100px]">{summary}</aside>
      </main>
    </div>
  );
}
