"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { BookFare, FindBooking, type Party } from "@/components/tripjack/flight-booking";
import { SupplierNote } from "@/components/tripjack/supplier-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import {
  clock, day, hoursMinutes, inr, plusDays, today,
  type FareRules, type FlightSearchResult, type FlightTrip, type Fare,
} from "@/lib/tripjack";

const CABINS = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const;
const POPULAR = ["DEL", "BOM", "BLR", "MAA", "HYD", "CCU", "GOI", "COK", "AMD", "PNQ", "DXB", "SIN", "BKK", "DPS", "LHR", "KUL"];
const REFUND: Record<Fare["refundable"], string> = {
  refundable: "Refundable",
  non_refundable: "Non-refundable",
  partially_refundable: "Partly refundable",
  unknown: "Refund unknown",
};

/** Search TripJack flights live and see the fares exactly as travellers would be shown them
 *  (our markup included). Each result opens its fares, and the cancellation and change rules. */
export default function TripJackFlightsPage() {
  const [from, setFrom] = useState("DEL");
  const [to, setTo] = useState("GOI");
  const [date, setDate] = useState(plusDays(30));
  const [back, setBack] = useState("");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cabin, setCabin] = useState<(typeof CABINS)[number]>("ECONOMY");
  const [direct, setDirect] = useState(false);
  const [sort, setSort] = useState<"price" | "duration" | "departure">("price");

  const search = useMutation({
    mutationFn: async () => {
      const legs = [{ origin: from.trim(), destination: to.trim(), date }, ...(back ? [{ origin: to.trim(), destination: from.trim(), date: back }] : [])];
      const res = await fetch("/api/backend/flights/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legs, adults, children, infants, cabin, direct_only: direct, sort }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : Array.isArray(body.detail) ? body.detail.map((d: { msg: string }) => d.msg).join("; ") : "The search failed");
      return { ...(body as FlightSearchResult), party: { adults, children, infants } as Party };
    },
  });
  const result = search.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="TripJack flights"
        description="Search flights live and see the fares as travellers would. Prices are for the whole party and include our markup. Open a fare to hold or book it on TripJack's test environment."
      />
      <Card className="mb-5">
        <FindBooking />
      </Card>
      <Card>
        <form
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            search.mutate();
          }}
        >
          <Field label="From (airport code)">
            <Input list="airports" value={from} maxLength={3} required onChange={(e) => setFrom(e.target.value.toUpperCase())} aria-label="From" />
          </Field>
          <Field label="To (airport code)">
            <Input list="airports" value={to} maxLength={3} required onChange={(e) => setTo(e.target.value.toUpperCase())} aria-label="To" />
          </Field>
          <Field label="Leaving">
            <Input type="date" min={today()} value={date} required onChange={(e) => setDate(e.target.value)} aria-label="Leaving" />
          </Field>
          <Field label="Returning (optional)">
            <Input type="date" min={date} value={back} onChange={(e) => setBack(e.target.value)} aria-label="Returning" />
          </Field>
          <Field label="Adults">
            <Input type="number" min={1} max={9} value={adults} onChange={(e) => setAdults(Number(e.target.value) || 1)} aria-label="Adults" />
          </Field>
          <Field label="Children (2–11)">
            <Input type="number" min={0} max={8} value={children} onChange={(e) => setChildren(Number(e.target.value) || 0)} aria-label="Children" />
          </Field>
          <Field label="Infants (under 2)">
            <Input type="number" min={0} max={9} value={infants} onChange={(e) => setInfants(Number(e.target.value) || 0)} aria-label="Infants" />
          </Field>
          <Field label="Cabin">
            <Select value={cabin} onChange={(e) => setCabin(e.target.value as typeof cabin)} aria-label="Cabin">
              {CABINS.map((c) => <option key={c} value={c}>{c.replace("_", " ").toLowerCase().replace(/^./, (m) => m.toUpperCase())}</option>)}
            </Select>
          </Field>
          <Field label="Sort by">
            <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="price">Cheapest first</option>
              <option value="duration">Shortest first</option>
              <option value="departure">Earliest first</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} /> Direct flights only
          </label>
          <div className="flex items-end sm:col-span-2 lg:col-span-1 lg:justify-end">
            <Button type="submit" variant="accent" disabled={search.isPending}>{search.isPending ? "Searching TripJack…" : "Search flights"}</Button>
          </div>
          <datalist id="airports">{POPULAR.map((c) => <option key={c} value={c} />)}</datalist>
        </form>
      </Card>

      <div className="mt-5">
        {search.isPending && <Spinner />}
        {search.error && <ErrorNote error={search.error} />}
        {result && (
          <Card>
            <SupplierNote supplier={result.supplier} />
            {result.flights.length === 0 ? (
              <p className="m-0 p-8 text-center text-sm text-muted">TripJack has no flights for that search.</p>
            ) : (
              <>
                <p className="m-0 border-b border-border px-4 py-2.5 text-sm text-muted">{result.total} {result.total === 1 ? "option" : "options"} for {from} → {to}{back ? " and back" : ""}</p>
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {result.flights.map((t, i) => <TripRow key={`${t.journey}-${t.cheapest.price_id}-${i}`} trip={t} party={result.party} />)}
                </ul>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function TripRow({ trip, party }: { trip: FlightTrip; party: Party }) {
  const [open, setOpen] = useState(false);
  const names = trip.airlines.map((a) => a.name || a.code).join(" + ");
  return (
    <li className="px-4 py-3" data-testid="flight-row">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full cursor-pointer flex-wrap items-center gap-x-6 gap-y-2 text-left" aria-expanded={open}>
        <span className="min-w-[160px] flex-1">
          <strong className="block">{names}</strong>
          <span className="text-xs text-muted">{trip.journey === "ONWARD" || trip.journey === "COMBO" ? "" : `${trip.journey.toLowerCase()} · `}{trip.legs.flat().map((s) => s.flight_number).join(", ")}</span>
        </span>
        <span className="text-center">
          <strong className="tabular-nums">{clock(trip.departs)} → {clock(trip.arrives)}</strong>
          <span className="block text-xs text-muted">{day(trip.departs)} · {hoursMinutes(trip.duration_minutes)} · {trip.stops === 0 ? "Direct" : `${trip.stops} ${trip.stops === 1 ? "stop" : "stops"}`}</span>
        </span>
        <span className="text-right">
          <strong className="text-lg tabular-nums">{inr(trip.cheapest.price.total)}</strong>
          <span className="block text-xs text-muted">{trip.fares.length} {trip.fares.length === 1 ? "fare" : "fares"} · {open ? "hide" : "show"}</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {trip.legs.map((leg, li) => (
              <div key={li} className="rounded-xl bg-surface-2/60 p-3 text-sm">
                {trip.legs.length > 1 && <strong className="mb-1 block text-xs uppercase tracking-wide text-muted">Leg {li + 1}</strong>}
                {leg.map((s, si) => (
                  <div key={si}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span><strong>{s.from.code}</strong> {clock(s.departs)} → <strong>{s.to.code}</strong> {clock(s.arrives)}</span>
                      <span className="text-xs text-muted">{s.airline.name} {s.flight_number} · {hoursMinutes(s.duration_minutes)}{s.airline.low_cost ? " · low-cost" : ""}</span>
                    </div>
                    <div className="text-xs text-muted">{[s.from.city || s.from.name, s.from.terminal].filter(Boolean).join(", ")} → {[s.to.city || s.to.name, s.to.terminal].filter(Boolean).join(", ")}</div>
                    {s.layover_minutes > 0 && si < leg.length - 1 && <div className="my-1.5 text-xs text-warn">Layover {hoursMinutes(s.layover_minutes)} at {s.to.city || s.to.code}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {trip.fares.map((f) => <FareRow key={f.price_id} fare={f} party={party} />)}
          </ul>
        </div>
      )}
    </li>
  );
}

function FareRow({ fare, party }: { fare: Fare; party: Party }) {
  const [rules, setRules] = useState(false);
  const load = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/backend/flights/fare-rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ price_id: fare.price_id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't load the fare rules");
      return body as FareRules;
    },
    onSuccess: () => setRules(true),
  });
  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>{fare.fare_name || fare.fare_type}</strong>{" "}
          <span className="text-muted">· {fare.cabin.replace("_", " ").toLowerCase()}</span>
        </span>
        <strong className="tabular-nums">{inr(fare.price.total)}</strong>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <Badge tone={fare.refundable === "refundable" ? "ok" : fare.refundable === "non_refundable" ? "danger" : "warn"}>{REFUND[fare.refundable]}</Badge>
        {fare.baggage.check_in && <span>Check-in {fare.baggage.check_in}</span>}
        {fare.baggage.cabin && <span>Cabin {fare.baggage.cabin}</span>}
        {fare.seats_left != null && <span>{fare.seats_left} seats left</span>}
        <span>Base {inr(fare.price.base)} + taxes {inr(fare.price.taxes)}</span>
      </div>
      <div className="mt-2">
        <Button size="sm" variant="secondary" disabled={load.isPending} onClick={() => (load.data ? setRules(!rules) : load.mutate())}>
          {load.isPending ? "Loading…" : rules ? "Hide fare rules" : "Cancellation and change rules"}
        </Button>
      </div>
      {load.error && <p className="m-0 mt-2 text-xs text-danger">{load.error.message}</p>}
      {rules && load.data && (
        <div className="mt-2 flex flex-col gap-2 text-xs">
          {Object.entries(load.data.sectors).map(([sector, kinds]) => (
            <div key={sector}>
              <strong>{sector}</strong>
              {Object.entries(kinds).map(([kind, bands]) => (
                <div key={kind} className="mt-1">
                  <span className="text-muted">{kind.replace(/_/g, " ").toLowerCase()}</span>
                  <ul className="m-0 list-none p-0">
                    {bands.map((b, i) => (
                      <li key={i} className="flex justify-between gap-3 tabular-nums">
                        <span>{b.from_hours ?? 0}–{b.to_hours ?? "∞"} h before departure</span>
                        <span>{b.airline_fee ? inr(b.airline_fee) : "Free"}{b.service_fee ? ` + ${inr(b.service_fee)} fee` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <BookFare priceId={fare.price_id} party={party} />
    </li>
  );
}
