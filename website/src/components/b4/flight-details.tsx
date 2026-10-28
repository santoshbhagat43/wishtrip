"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { ApiError, api, errorMessage } from "@/lib/api/client";

import { Modal } from "./modal";

type Airport = { code: string; name: string; city: string; terminal: string };
type Segment = {
  airline: { code: string; name: string };
  flight_number: string;
  from: Airport;
  to: Airport;
  departs: string;
  arrives: string;
  duration_minutes: number;
  layover_minutes: number;
};
type Fare = {
  price_id: string;
  fare_name: string;
  cabin: string;
  refundable: string;
  baggage: { check_in: string; cabin: string };
  seats_left: number | null;
  price: { total: number; base: number; taxes: number };
};
type Flight = {
  journey: string;
  legs: Segment[][];
  departs: string;
  arrives: string;
  duration_minutes: number;
  stops: number;
  airlines: { code: string; name: string }[];
  cheapest: Fare;
  fares: Fare[];
};
type Band = { from_hours: number | null; to_hours: number | null; airline_fee: number; service_fee: number; note: string };
type Rules = { sectors: Record<string, Record<string, Band[]>> };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const JOURNEY: Record<string, string> = { ONWARD: "Going", RETURN: "Coming back", COMBO: "Return trip" };
const REFUND: Record<string, string> = { refundable: "Refundable", non_refundable: "Non-refundable", partially_refundable: "Partly refundable" };
const RULE: Record<string, string> = { CANCELLATION: "Cancel", DATECHANGE: "Change date", NO_SHOW: "No-show" };

const FIELD = "h-11 rounded-xl border-[1.5px] border-[#E3E8EE] bg-white px-3 text-[15px] outline-none focus:border-[#0A7C80]";

function band(b: Band) {
  const from = b.from_hours ?? 0;
  const span = b.to_hours == null || b.to_hours > 9999 ? `${from}+ h before` : `${from}–${b.to_hours} h before`;
  return `${span}: ${inr(b.airline_fee)}${b.service_fee ? ` + ${inr(b.service_fee)} fee` : ""}`;
}

function FareRules({ priceId }: { priceId: string }) {
  const [state, setState] = useState<{ rules?: Rules; error?: string; loading?: boolean }>({});
  async function load() {
    setState({ loading: true });
    const r = await api.POST("/flights/fare-rules", { body: { price_id: priceId } });
    if (r.error !== undefined) return setState({ error: errorMessage(r.error) });
    setState({ rules: r.data as unknown as Rules });
  }
  if (!state.rules) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button type="button" onClick={load} disabled={state.loading} className="text-[13px] font-semibold text-[#0A7C80]">
          {state.loading ? "Loading rules…" : "Cancellation and change rules"}
        </button>
        {state.error && <span className="text-[12px] text-[#C43B58]">{state.error}</span>}
      </div>
    );
  }
  const sectors = Object.entries(state.rules.sectors);
  if (!sectors.length) return <span className="text-[12.5px] text-[#566E85]">The airline hasn’t published rules for this fare.</span>;
  return (
    <div className="flex flex-col gap-2 text-[12.5px] text-[#3F5A72]">
      {sectors.map(([sector, rules]) => (
        <div key={sector}>
          <strong>{sector}</strong>
          {Object.entries(rules).filter(([k]) => RULE[k]).map(([kind, bands]) => (
            <div key={kind} className="mt-1">
              <span className="font-semibold">{RULE[kind]}</span>
              <ul className="m-0 list-none p-0">{bands.map((b, i) => <li key={i}>{band(b)}</li>)}</ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FlightRow({ f }: { f: Flight }) {
  const [open, setOpen] = useState(false);
  const names = f.airlines.map((a) => a.name || a.code).join(" + ");
  return (
    <article className="rounded-2xl border border-[#E3E8EE]">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-3.5 text-left">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="text-[15px]">{time(f.departs)} → {time(f.arrives)}</strong>
          <span className="truncate text-[12.5px] text-[#566E85]">{names} · {hm(f.duration_minutes)} · {f.stops === 0 ? "Non-stop" : `${f.stops} ${f.stops === 1 ? "stop" : "stops"}`}</span>
        </span>
        <span className="flex flex-col items-end">
          <strong className="text-[16px] tabular-nums">{inr(f.cheapest.price.total)}</strong>
          <span className="text-[11.5px] text-[#0A7C80]">{open ? "Hide details" : "Details"}</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-[#E8EDF2] p-4">
          {f.legs.map((leg, li) => (
            <ol key={li} className="m-0 flex list-none flex-col gap-2 p-0">
              {leg.map((s, i) => (
                <li key={i} className="text-[13px]">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <strong>{s.airline.name || s.airline.code} {s.flight_number}</strong>
                    <span className="text-[#566E85]">{day(s.departs)} · {hm(s.duration_minutes)}</span>
                  </div>
                  <div>{time(s.departs)} {s.from.city || s.from.code} ({s.from.code}{s.from.terminal ? `, ${s.from.terminal}` : ""}) → {time(s.arrives)} {s.to.city || s.to.code} ({s.to.code}{s.to.terminal ? `, ${s.to.terminal}` : ""})</div>
                  {s.layover_minutes > 0 && <div className="mt-1 text-[12px] font-semibold text-[#B86E00]">Layover {hm(s.layover_minutes)} in {s.to.city || s.to.code}</div>}
                </li>
              ))}
            </ol>
          ))}
          <div className="flex flex-col gap-2.5">
            <span className="text-[12px] font-bold tracking-[.08em] text-[#566E85]">FARES</span>
            {f.fares.map((fare) => (
              <div key={fare.price_id} className="flex flex-col gap-1.5 rounded-xl bg-[#F8FAFC] p-3 text-[12.5px]">
                <span className="flex items-baseline justify-between gap-3">
                  <strong className="text-[13.5px]">{fare.fare_name || fare.cabin.replace("_", " ").toLowerCase()}</strong>
                  <strong className="tabular-nums">{inr(fare.price.total)}</strong>
                </span>
                <span className="text-[#566E85]">
                  {REFUND[fare.refundable] ?? "Refund terms unknown"}
                  {fare.baggage.check_in && ` · Check-in ${fare.baggage.check_in}`}
                  {fare.baggage.cabin && ` · Cabin ${fare.baggage.cabin}`}
                  {fare.seats_left != null && fare.seats_left <= 9 && ` · ${fare.seats_left} seats left`}
                </span>
                <span className="text-[#566E85]">Base {inr(fare.price.base)} + taxes {inr(fare.price.taxes)}</span>
                <FareRules priceId={fare.price_id} />
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

/** Live flights for the trip's route, from TripJack. Needs sign-in (the search is per person). */
export function FlightDialog({ where, nights, signedIn, onClose }: { where: string; nights: number; signedIn: boolean; onClose: () => void }) {
  const [today] = useState(() => Date.now());
  const soon = (d: number) => new Date(today + d * 864e5).toISOString().slice(0, 10);
  const [form, setForm] = useState({ from: "", to: "", out: soon(30), back: soon(30 + nights), adults: 2 });
  const [oneWay, setOneWay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flights, setFlights] = useState<Flight[] | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFlights(null);
    const legs = [{ origin: form.from, destination: form.to, date: form.out }];
    if (!oneWay) legs.push({ origin: form.to, destination: form.from, date: form.back });
    try {
      const r = await api.POST("/flights/search", { body: { legs, adults: form.adults, children: 0, infants: 0, cabin: "ECONOMY", direct_only: false, sort: "price" } });
      if (r.error !== undefined) throw new ApiError(errorMessage(r.error), r.response.status);
      setFlights(((r.data as unknown as { flights: Flight[] }).flights ?? []).slice(0, 25));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flight fares are not available right now");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: "out" | "back" | "adults") => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: k === "adults" ? Number(e.target.value) : e.target.value });
  const groups = flights ? [...new Set(flights.map((f) => f.journey))] : [];

  return (
    <Modal title={`Flights to ${where}`} onClose={onClose}>
      {!signedIn ? (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 text-[14.5px] text-[#3F5A72]">Sign in to see live flights and fares for your dates.</p>
          <Link href="/login" className="rounded-full bg-[#22DDE0] px-6 py-3 text-[15px] font-bold text-[#072338] no-underline">Sign in</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <form onSubmit={search} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">From (airport code)
              <input required minLength={3} maxLength={3} placeholder="BLR" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value.toUpperCase() })} className={`${FIELD} uppercase`} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">To (airport code)
              <input required minLength={3} maxLength={3} placeholder="DPS" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value.toUpperCase() })} className={`${FIELD} uppercase`} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Leaving
              <input type="date" required min={soon(0)} value={form.out} onChange={set("out")} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Coming back
              <input type="date" required={!oneWay} disabled={oneWay} min={form.out} value={form.back} onChange={set("back")} className={`${FIELD} disabled:opacity-40`} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">Travellers
              <input type="number" min={1} max={9} value={form.adults} onChange={set("adults")} className={FIELD} />
            </label>
            <label className="flex items-end gap-2 pb-3 text-[13px]"><input type="checkbox" checked={oneWay} onChange={(e) => setOneWay(e.target.checked)} /> One way</label>
            <button type="submit" disabled={busy} className="col-span-2 h-11 self-end rounded-full bg-[#22DDE0] text-[15px] font-bold text-[#072338] disabled:opacity-60">{busy ? "Searching…" : "Search flights"}</button>
          </form>
          {error && <p className="m-0 text-[13.5px] text-[#C43B58]">{error}</p>}
          {flights && flights.length === 0 && <p className="m-0 text-[14px] text-[#566E85]">No flights came back for those dates. Try other dates or airports.</p>}
          {groups.map((g) => (
            <div key={g} className="flex flex-col gap-2.5">
              {groups.length > 1 || g !== "ONWARD" ? <strong className="text-[13px] tracking-wide text-[#566E85]">{(JOURNEY[g] ?? g).toUpperCase()}</strong> : null}
              {flights!.filter((f) => f.journey === g).map((f, i) => <FlightRow key={`${g}-${i}`} f={f} />)}
            </div>
          ))}
          <span className="text-[11.5px] text-[#5F6B78]">Live fares from TripJack for the whole party. Seeing a fare here isn’t a booking; nothing is charged until checkout.</span>
        </div>
      )}
    </Modal>
  );
}
