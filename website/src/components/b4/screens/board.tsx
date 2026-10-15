"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { api, unwrap } from "@/lib/api/client";
import { useMe } from "@/lib/session";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, Why } from "../flow";
import { buildDays, kindLabel, useReelImport } from "../trip-journey";

/** Step 3: the trip board built from the reel's places, day by day. Travellers book it;
 *  creators save it and get an affiliate link to promote. */
export function BoardScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const days = Number(params.get("days")) || undefined;
  const imp = useReelImport(id);
  const me = useMe();
  const content = imp.data?.content;
  const isCreator = me.data?.role === "creator";

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    try {
      const trip = unwrap(await api.POST("/creator/trips/from-reel", { body: { import_id: id! } }));
      setShareUrl(`${window.location.origin}/t/${trip.share_code}`);
    } catch {
      setShareUrl("error");
    }
  };

  if (imp.isLoading || me.isLoading) return <Shell><p className="p-10 text-center text-[#566E85]">Building your board…</p></Shell>;
  if (!content) {
    return (
      <Shell>
        <p className="p-10 text-center text-[#566E85]">
          We couldn’t find that trip. <Link href={LINKS.reel} className="font-semibold text-[#0A7C80] underline">Start from a reel</Link>.
        </p>
      </Shell>
    );
  }

  const where = content.destination_name || "your trip";
  const schedule = buildDays(content.places, days ?? content.days_hint ?? 3);
  const kept = content.places.filter((p) => p.kind !== "area");

  const included = (
    <div className={`${CARD} flex flex-col gap-2.5 rounded-[22px] p-5`}>
      <Kicker>WHAT’S ON YOUR BOARD</Kicker>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13.5px] text-[#3F5A72]">
        <li>Flights and transfers</li>
        <li>A place to stay</li>
        <li>{kept.length} experiences and food spots from the reel</li>
      </ul>
      <span className="mt-0.5 border-t border-[#EDE6DC] pt-3 text-[13px] text-[#566E85]">
        Your all-in price is shown at checkout, before anything is charged.
      </span>
      {isCreator ? (
        shareUrl && shareUrl !== "error" ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-[#E3F5EE] p-3.5">
            <strong className="text-[14px] text-[#0B7A57]">Saved — share this link</strong>
            <span className="flex gap-2">
              <input readOnly value={shareUrl} className="min-w-0 flex-1 rounded-lg border border-[#BDEFF0] bg-white px-2.5 py-2 text-[12.5px]" />
              <button onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); }} className="rounded-full bg-[#072338] px-3.5 text-[13px] font-semibold text-white">{copied ? "Copied" : "Copy"}</button>
            </span>
            <span className="text-[12px] text-[#0B7A57]">Every booking through it earns your commission.</span>
          </div>
        ) : (
          <>
            <button onClick={save} className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338]">
              Save &amp; get my link
            </button>
            {shareUrl === "error" && <span className="text-center text-[12px] text-[#B8362A]">Couldn’t save — please try again.</span>}
            <span className="text-center text-xs text-[#566E85]">Publishes your trip and gives you an affiliate link to promote.</span>
          </>
        )
      ) : (
        <>
          <button onClick={() => router.push(`${LINKS.checkout}?id=${id}`)} className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338]">
            Book in one go
          </button>
          <span className="text-center text-xs text-[#566E85]">Nothing is charged until you choose at checkout.</span>
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader step={3} title={`Your ${where} trip`} subtitle={`${schedule.length} days · from your reel`} back={`${LINKS.details}?id=${id}`} signedIn />
      <main className="mx-auto grid max-w-[1240px] grid-cols-1 items-start gap-8 px-4 pb-16 pt-6 md:grid-cols-[1fr_340px] md:px-10 md:pt-8">
        <section className="flex flex-col gap-2.5">
          <Kicker teal>YOUR TRIP BOARD</Kicker>
          <h1 className="font-display mb-1 mt-1 text-[32px] font-medium leading-tight md:text-[44px]">Your {where} trip</h1>
          <div className="grid gap-2.5 md:grid-cols-2">
            {schedule.map((d) => (
              <div key={d.n} className="flex flex-col gap-2 rounded-[20px] bg-[#F4EFE8] p-3">
                <span className="flex flex-col px-1 pt-0.5">
                  <span className="text-[11.5px] font-bold text-[#0A7C80]">DAY {d.n}</span>
                  <strong className="font-display text-lg font-medium leading-[1.2]">{d.title}</strong>
                </span>
                {d.items.map((it, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-[14px] border border-[#E8E1D8] bg-white p-2.5">
                    <span className="grid size-10 flex-none place-items-center rounded-[10px] bg-[#F4EFE8] text-[11px] font-bold text-[#0A7C80]">{it.when.slice(0, 3)}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="text-[11px] font-semibold text-[#8A7F72]">{kindLabel(it.kind)}</span>
                      <strong className="text-[13.5px] leading-[1.3]">{it.name}</strong>
                      {it.note && <span className="self-start"><Why>{it.note.slice(0, 48)}</Why></span>}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
        <aside className="md:sticky md:top-[100px]">{included}</aside>
      </main>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader step={3} title="Your trip" subtitle="Trip board" back={LINKS.reel} signedIn />
      {children}
    </div>
  );
}
