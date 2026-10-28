"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker, MobileBar, SELECTED, UNSELECTED } from "../flow";
import { GROUPS, PACES, PEOPLE } from "../flow-data";
import { Path } from "../icons";
import { api, errorMessage, unwrap } from "@/lib/api/client";
import { AIRPORTS, airportFrom, airportLabel } from "../airports";

import { partyText, samplePrices, useMineTrip, usePublicTrip, useReelImport } from "../trip-journey";

type Count = "adults" | "kids" | "seniors";
const FIELD =
  "rounded-xl border-[1.5px] border-[#E3E8EE] bg-white px-3.5 py-[13px] text-[15.5px] font-medium tracking-normal text-[#0D2436] outline-none focus:border-[#0A7C80]";
const LABEL = "flex flex-col gap-2 text-[10.5px] font-bold tracking-[.14em] text-[#5F6B78]";

/** Step 2a: who's coming, when, how many days and pace — from the reel you just imported. */
export function DetailsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const id = params.get("id");
  // "Make it mine": the traveller starts from a creator's published trip instead of a reel.
  const code = params.get("trip");
  // Coming back to a trip already made: its trip number, so the details are as they were left.
  const mineCode = params.get("mine");
  const saved = useMineTrip(mineCode).data;
  const imp = useReelImport(code ? null : id);
  const shared = usePublicTrip(code);
  const sharedTrip = shared.data;
  const who = sharedTrip ? sharedTrip.creator.display_name || (sharedTrip.creator.handle ? `@${sharedTrip.creator.handle}` : "a creator") : "";
  const sharedStops = sharedTrip?.items.filter((i) => i.kind !== "note" && i.name.trim()) ?? [];
  const sharedDays = sharedTrip ? new Set(sharedTrip.items.map((i) => i.day ?? 1)).size : undefined;
  const content = sharedTrip
    ? { destination_name: sharedTrip.destination_name, days_hint: sharedDays, places: sharedStops.map((i) => ({ name: i.name, kind: i.kind, location_name: null as string | null })) }
    : imp.data?.content;
  const loading = code ? shared.isLoading : imp.isLoading;
  const where = content?.destination_name || "your trip";

  const [group, setGroup] = useState("couple");
  const [count, setCount] = useState<Record<Count, number>>({ adults: 2, kids: 0, seniors: 0 });
  const [days, setDays] = useState<number>(content?.days_hint ?? 4);
  const [pace, setPace] = useState("relaxed");
  const n = count.adults + count.kids + count.seniors;
  const travellers = `${n} ${n === 1 ? "TRAVELLER" : "TRAVELLERS"}`;
  // The same sample prices the board uses (real ones come at checkout), for who is going and how long.
  const estimate = samplePrices(Math.max(1, n), Math.max(1, days - 1)).total;
  const bump = (k: Count, by: number) => setCount({ ...count, [k]: Math.max(0, Math.min(9, count[k] + by)) });

  const [start, setStart] = useState(""); // the day they leave (yyyy-mm-dd)
  const [fromText, setFromText] = useState(""); // where from, as picked: "Delhi (DEL)"
  const from = airportFrom(fromText);
  const today = new Date().toISOString().slice(0, 10);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Show the saved details once they arrive (set while rendering, once per saved trip).
  const [seeded, setSeeded] = useState<string | null>(null);
  if (saved && seeded !== saved.code) {
    const match = GROUPS.find((g) => g.c[0] === saved.adults && g.c[1] === saved.kids && g.c[2] === saved.seniors);
    setSeeded(saved.code);
    setGroup(saved.group || (match?.id ?? ""));
    setCount({ adults: saved.adults, kids: saved.kids, seniors: saved.seniors });
    setDays(saved.days);
    setPace(saved.pace);
    setStart(saved.start_date ?? "");
    setFromText(saved.origin ? airportLabel(airportFrom(saved.origin) ?? { code: saved.origin, city: saved.origin_city || saved.origin }) : "");
  }

  const next = async (viaArya = false) => {
    if (!code && !id) return router.push(LINKS.reel);
    // Build the trip for this party under its own number, then open it: the number is the way
    // back. It is planned in the background, and the trip page shows it filling in.
    setSaving(true);
    setProblem(null);
    if (fromText.trim() && !from) {
      setProblem("Pick the city you are travelling from from the list.");
      setSaving(false);
      return;
    }
    const body = { ...count, days, pace, when: "", group, arya: viaArya, start_date: start || null, origin: from?.code ?? "", origin_city: from?.city ?? "" };
    try {
      const made = mineCode
        ? unwrap(await api.PATCH("/my-trips/{code}", { params: { path: { code: mineCode } }, body }))
        : code
          ? unwrap(await api.POST("/trips/{share_code}/make-mine", { params: { path: { share_code: code } }, body }))
          : unwrap(await api.POST("/reels/imports/{import_id}/build", { params: { path: { import_id: id! } }, body }));
      queryClient.setQueryData(["mine-trip", made.code], made); // the trip page shows what was just saved
      if (viaArya) {
        // Straight into the chat, which starts with this trip (its number, details and stops).
        const chat = unwrap(await api.POST("/my-trips/{code}/arya", { params: { path: { code: made.code } } }));
        router.push(`${LINKS.arya}?session=${chat.session_id}&send=${encodeURIComponent(chat.message)}`);
        return;
      }
      router.push(`${LINKS.mine}/${made.code}`);
    } catch (e) {
      setProblem(errorMessage(e));
      setSaving(false);
    }
  };

  const starting = content && (
    <div className={`${CARD} flex flex-col gap-2 p-4`}>
      <Kicker>{code ? `FROM ${who.toUpperCase()}’S TRIP` : "FROM YOUR REEL"}</Kicker>
      <strong className="text-[15px]">
        {content.places.length} {content.places.length === 1 ? "place" : "places"} in {where}
      </strong>
      <span className="text-[12.5px] leading-normal text-[#566E85]">
        {content.places.filter((p) => p.kind !== "area").map((p) => p.location_name ?? p.name).slice(0, 6).join(" · ")}
      </span>
    </div>
  );

  const form = (
    <div className={`${CARD} flex flex-col gap-[22px] rounded-3xl p-4 md:p-[26px]`}>
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[10.5px] font-bold tracking-[.14em] text-[#5F6B78]">WHO’S COMING</legend>
        <div role="radiogroup" aria-label="Who’s coming" className="grid grid-cols-5 gap-1.5 md:gap-2.5">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={group === g.id}
              onClick={() => {
                setGroup(g.id);
                setCount({ adults: g.c[0], kids: g.c[1], seniors: g.c[2] });
              }}
              className={`flex min-h-24 cursor-pointer flex-col items-center gap-1.5 rounded-2xl bg-white px-0.5 py-2.5 text-center text-[#0D2436] md:min-h-[126px] md:px-2 md:py-3.5 ${group === g.id ? SELECTED : UNSELECTED}`}
            >
              <span aria-hidden="true" className="grid size-[42px] place-items-center rounded-full md:size-[54px]" style={{ background: g.tint }}>
                <Path d={g.icon} size={22} stroke={g.col} width={1.8} />
              </span>
              <span className="text-[12.5px] font-semibold md:text-[14.5px]">{g.label}</span>
              <span className="hidden text-xs text-[#566E85] md:block">{g.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-3">
          {PEOPLE.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-2 rounded-[14px] border border-[#E3E8EE] bg-white py-1.5 pl-3.5 pr-1.5">
              <span className="flex flex-col">
                <strong className="text-sm font-semibold">{p.label}</strong>
                <span className="text-xs text-[#566E85]">{p.hint}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <button type="button" aria-label={`Fewer ${p.label}`} onClick={() => bump(p.key, -1)} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">−</button>
                <span className="min-w-[18px] text-center font-bold tabular-nums">{count[p.key]}</span>
                <button type="button" aria-label={`More ${p.label}`} onClick={() => bump(p.key, 1)} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">+</button>
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className={LABEL}>
          START DATE
          <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start date" className={FIELD} />
        </label>
        <label className={`${LABEL} md:col-span-2`}>
          TRAVELLING FROM
          <input
            list="b4-airports"
            value={fromText}
            onChange={(e) => setFromText(e.target.value)}
            placeholder="Your city, e.g. Delhi"
            aria-label="Travelling from"
            autoComplete="off"
            className={FIELD}
          />
          <datalist id="b4-airports">
            {AIRPORTS.map((a) => <option key={a.code} value={airportLabel(a)} />)}
          </datalist>
          <span className="text-xs font-normal normal-case tracking-normal text-[#566E85]">With your dates, this lets us look up live flight and hotel prices.</span>
        </label>
        <div className={LABEL}>
          HOW MANY DAYS
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Fewer days" onClick={() => setDays((d) => Math.max(1, d - 1))} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">−</button>
            <span className="min-w-[70px] rounded-xl border-[1.5px] border-[#E3E8EE] bg-white py-[11px] text-center text-[15.5px] font-semibold">{days} days</span>
            <button type="button" aria-label="More days" onClick={() => setDays((d) => Math.min(7, d + 1))} className="size-10 cursor-pointer rounded-full border-[1.5px] border-[#E3E8EE] bg-white text-lg">+</button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[10.5px] font-bold tracking-[.14em] text-[#5F6B78]">PACE</span>
        <div role="radiogroup" aria-label="Pace" className="grid grid-cols-3 gap-2">
          {PACES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={pace === p.id}
              onClick={() => setPace(p.id)}
              className={`min-h-[54px] cursor-pointer rounded-[14px] bg-white px-3.5 py-[11px] text-left text-[#0D2436] ${pace === p.id ? SELECTED : UNSELECTED}`}
            >
              <span className="block text-sm font-semibold">{p.label}</span>
              <span className="mt-0.5 block text-xs text-[#566E85]">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#FFFFFF]">
      <FlowHeader step={code ? 1 : 2} title={`Your ${where} trip`} subtitle="Your details" back={code ? `/t/${code}` : LINKS.reel} signedIn />
      {loading ? (
        <p className="p-10 text-center text-[#566E85]">{code ? "Loading the trip…" : "Loading your reel…"}</p>
      ) : !content ? (
        <p className="p-10 text-center text-[#566E85]">We couldn’t find that trip. <Link href={code ? LINKS.home : LINKS.reel} className="font-semibold text-[#0A7C80] underline">{code ? "Explore wishtrip" : "Start from a reel"}</Link>.</p>
      ) : (
        <>
          {/* Phones */}
          <div className="md:hidden">
            <section className="px-4 pb-1.5 pt-3.5">{starting}</section>
            <section className="px-4 pb-[150px] pt-2.5">{form}</section>
            <MobileBar>
              <span className="flex flex-col gap-0.5">
                <span className="text-[10.5px] font-bold tracking-[.14em] text-[#A9C2D4]">{days} DAYS · {travellers} · EST. {estimate}</span>
                <span className="text-xs text-[#A9C2D4]">{code ? "Your trip shows the day-by-day." : "Your board shows the day-by-day."}</span>
              </span>
              <button type="button" onClick={() => next(true)} disabled={saving || n < 1} className="ml-auto whitespace-nowrap rounded-full border-[1.5px] border-[#22DDE0] px-[14px] py-[11px] text-[14px] font-bold text-[#22DDE0] disabled:opacity-60">
                Chat with Arya
              </button>
              <button onClick={() => next()} disabled={saving || n < 1} className="whitespace-nowrap rounded-full bg-[#22DDE0] px-[18px] py-[13px] text-[15px] font-bold text-[#072338] disabled:opacity-60">
                {saving ? "Building…" : "Build my trip"}
              </button>
            </MobileBar>
          </div>

          {/* Desktop */}
          <main className="mx-auto hidden max-w-[1240px] grid-cols-[1fr_360px] items-start gap-9 px-10 pb-[72px] pt-10 md:grid">
            <section className="flex flex-col gap-[18px]">
              <div>
                <Kicker teal>YOUR DETAILS</Kicker>
                <h1 className="font-display mb-0 mt-1.5 text-[46px] font-medium leading-[1.08]">Your {where} trip</h1>
                <p className="mb-0 mt-2 text-[15.5px] text-[#3F5A72]">
                  {code ? `A few quick things, then we shape ${who}’s trip around you.` : "A few quick things, then your board builds itself from the reel."}
                </p>
              </div>
              {form}
            </section>
            <aside className="sticky top-[100px] flex flex-col gap-3.5">
              {starting}
              <div className="flex flex-col gap-4 rounded-[22px] bg-[#072338] p-[22px] text-white">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] font-bold tracking-[.14em] text-[#A9C2D4]">ESTIMATE FOR {travellers}</span>
                  <strong className="text-[32px] tabular-nums">{estimate}</strong>
                  <span className="text-xs text-[#A9C2D4]">
                    {days} days · {partyText(count) || travellers.toLowerCase()}. A sample; your trip then shows live flight and hotel prices for your dates.
                  </span>
                </span>
                <button
                  onClick={() => next()}
                  disabled={saving || n < 1}
                  className="cursor-pointer rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] disabled:opacity-60"
                >
                  {saving ? "Building…" : "Build my trip →"}
                </button>
                {problem && <span role="alert" className="text-center text-[12.5px] text-[#FFB4AA]">{problem}</span>}
              </div>
              <button
                type="button"
                onClick={() => next(true)}
                disabled={saving || n < 1}
                className="flex cursor-pointer items-center gap-3 rounded-[20px] border border-[#E3E8EE] bg-white px-4 py-3.5 text-left text-[#0D2436] disabled:opacity-60"
              >
                <span aria-hidden="true" className="font-display grid size-[38px] flex-none place-items-center rounded-full bg-gradient-to-br from-[#22DDE0] to-[#1A6094] text-xl font-semibold italic text-white">A</span>
                <span className="flex flex-col">
                  <strong className="text-[14.5px]">Chat with Arya instead</strong>
                  <span className="text-[12.5px] text-[#566E85]">Keep these details; Arya opens with your trip and changes it as you talk.</span>
                </span>
              </button>
            </aside>
          </main>
        </>
      )}
    </div>
  );
}
