"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { inr, type Supplier } from "@/lib/tripjack";

import { SupplierNote } from "./supplier-note";

/** Booking a TripJack flight to test the API: review a fare, hold or book it, then read the
 *  booking, ticket the hold or release it. The backend only allows this against TripJack's test
 *  environment, and sends TripJack its own total (not our marked-up price). */

export type Party = { adults: number; children: number; infants: number };
type PaxType = "ADULT" | "CHILD" | "INFANT";
/** TripJack's price (what we pay) and the traveller's price with our markup on the base fare. */
type Price = { tripjack: number | null; base: number | null; taxes: number | null; with_markup: number | null; currency: string };
type Review = {
  booking_id: string;
  total: number | null;
  price: Price;
  hold_allowed: boolean;
  session_seconds: number | null;
  needs: Record<"pan" | "passport" | "passport_expiry" | "dob_adult" | "dob_child" | "dob_infant" | "gst" | "emergency_contact", boolean>;
  alerts: unknown[];
  raw: unknown;
  supplier: Supplier;
};
type Booking = {
  booking_id: string | null;
  status: string | null;
  amount: number | null;
  total: number | null;
  price: Price;
  pnrs: string[];
  tickets: string[];
  travellers: { name: string; type: string }[];
  created_on: string | null;
  hold_deadlines: Record<string, unknown>;
  raw: unknown;
  supplier: Supplier;
};
type Traveller = {
  type: PaxType;
  title: string;
  first_name: string;
  last_name: string;
  dob: string;
  pan: string;
  passport_number: string;
  passport_expiry: string;
  passport_nationality: string;
};

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/backend/flights/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: { msg: string }) => d.msg).join("; ") : "TripJack call failed");
  }
  return data as T;
}

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  SUCCESS: "ok", ON_HOLD: "warn", PENDING: "warn", FAILED: "danger", ABORTED: "danger", CANCELLED: "neutral", UNCONFIRMED: "neutral",
};

function travellersFor(party: Party): Traveller[] {
  const blank = (type: PaxType, title: string): Traveller => ({
    type, title, first_name: "", last_name: "", dob: "", pan: "", passport_number: "", passport_expiry: "", passport_nationality: "",
  });
  return [
    ...Array.from({ length: party.adults }, () => blank("ADULT", "Mr")),
    ...Array.from({ length: party.children }, () => blank("CHILD", "Master")),
    ...Array.from({ length: party.infants }, () => blank("INFANT", "Master")),
  ];
}

/** How long until a deadline TripJack gave, when it reads as a date and time. */
function untilText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const when = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  if (Number.isNaN(when.getTime())) return "";
  const minutes = Math.round((when.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return `${when.toLocaleString("en-IN")} · passed`;
  return `${when.toLocaleString("en-IN")} · ${Math.floor(minutes / 60)} h ${minutes % 60} min from now`;
}

/** The price, both ways: TripJack's (what we pay) and the traveller's (with our markup). */
function PriceLine({ price, label, note }: { price: Price; label: string; note?: string }) {
  return (
    <div className="rounded-md bg-surface-2/60 p-2 text-xs" data-testid="tripjack-price">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <strong className="text-sm">{label}</strong>
        <span>
          TripJack <strong className="text-sm tabular-nums">{price.tripjack != null ? inr(price.tripjack) : "—"}</strong>{" "}
          <span className="text-muted">(what we pay)</span>
        </span>
        {price.with_markup != null && (
          <span>
            Traveller pays <strong className="text-sm tabular-nums">{inr(price.with_markup)}</strong>{" "}
            <span className="text-muted">(with our markup)</span>
          </span>
        )}
      </div>
      {price.base != null && price.taxes != null && (
        <div className="mt-0.5 text-muted">TripJack base {inr(price.base)} + taxes {inr(price.taxes)}{note ? ` · ${note}` : ""}</div>
      )}
    </div>
  );
}

function Raw({ value, label = "TripJack's answer" }: { value: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? `Hide ${label}` : `Show ${label}`}</Button>
      {open && <pre className="m-0 mt-1 max-h-80 overflow-auto rounded-lg bg-surface-2/60 p-2 text-[11px]">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

/** Review one fare, then hold it or book it. */
export function BookFare({ priceId, party }: { priceId: string; party: Party }) {
  const review = useMutation({ mutationFn: () => call<Review>("POST", "review", { price_ids: [priceId] }) });
  const [made, setMade] = useState<string | null>(null);

  if (made) return <BookingCard bookingId={made} quoted={review.data?.price} />;
  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-3">
      {!review.data && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accent" disabled={review.isPending} onClick={() => review.mutate()}>
            {review.isPending ? "Reviewing with TripJack…" : "Review to hold or book"}
          </Button>
          <span className="text-xs text-muted">TripJack test environment only. Nothing is paid for real.</span>
        </div>
      )}
      {review.error && <ErrorNote error={review.error} />}
      {review.data && <ReviewedFare review={review.data} party={party} onMade={setMade} />}
    </div>
  );
}

function ReviewedFare({ review, party, onMade }: { review: Review; party: Party; onMade: (id: string) => void }) {
  const [travellers, setTravellers] = useState(() => travellersFor(party));
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+91");
  const needs = review.needs;
  const set = (i: number, patch: Partial<Traveller>) => setTravellers(travellers.map((t, n) => (n === i ? { ...t, ...patch } : t)));
  const book = useMutation({
    mutationFn: (mode: "hold" | "book") =>
      call<{ booking_id: string }>("POST", "book", {
        booking_id: review.booking_id,
        mode,
        amount: mode === "book" ? review.total : undefined,
        email,
        phone,
        travellers: travellers.map((t) => ({
          type: t.type, title: t.title, first_name: t.first_name, last_name: t.last_name,
          dob: t.dob || undefined, pan: t.pan, passport_number: t.passport_number,
          passport_expiry: t.passport_expiry || undefined, passport_nationality: t.passport_nationality,
        })),
      }),
    onSuccess: (r) => onMade(r.booking_id),
  });
  const dobNeeded = (t: PaxType) => (t === "ADULT" ? needs.dob_adult : t === "CHILD" ? needs.dob_child : needs.dob_infant);
  const asked = Object.entries(needs).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " "));

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SupplierNote supplier={review.supplier} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>TripJack booking <code>{review.booking_id}</code></span>
        <Badge tone={review.hold_allowed ? "ok" : "danger"}>{review.hold_allowed ? "Hold allowed" : "No hold on this fare"}</Badge>
        {review.session_seconds != null && <span className="text-xs text-muted">Review good for {Math.round(review.session_seconds / 60)} min</span>}
      </div>
      <PriceLine price={review.price} label="Price now" />
      {review.alerts.length > 0 && <p className="m-0 text-xs text-warn">The fare changed since the search: {JSON.stringify(review.alerts)}</p>}
      <p className="m-0 text-xs text-muted">This fare needs: {asked.length ? asked.join(", ") : "names and a contact only"}.</p>

      {travellers.map((t, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-4">
          <Field label={`${t.type.toLowerCase()} ${i + 1} · title`}>
            <Select value={t.title} onChange={(e) => set(i, { title: e.target.value })} aria-label={`Title ${i + 1}`}>
              {(t.type === "ADULT" ? ["Mr", "Mrs", "Ms"] : ["Master", "Ms"]).map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="First name">
            <Input value={t.first_name} onChange={(e) => set(i, { first_name: e.target.value })} aria-label={`First name ${i + 1}`} />
          </Field>
          <Field label="Last name">
            <Input value={t.last_name} onChange={(e) => set(i, { last_name: e.target.value })} aria-label={`Last name ${i + 1}`} />
          </Field>
          {(dobNeeded(t.type) || t.type === "INFANT") && (
            <Field label="Date of birth">
              <Input type="date" value={t.dob} onChange={(e) => set(i, { dob: e.target.value })} aria-label={`Date of birth ${i + 1}`} />
            </Field>
          )}
          {needs.pan && (
            <Field label="PAN">
              <Input value={t.pan} maxLength={10} onChange={(e) => set(i, { pan: e.target.value.toUpperCase() })} aria-label={`PAN ${i + 1}`} />
            </Field>
          )}
          {needs.passport && (
            <>
              <Field label="Passport number">
                <Input value={t.passport_number} onChange={(e) => set(i, { passport_number: e.target.value })} aria-label={`Passport ${i + 1}`} />
              </Field>
              <Field label="Passport expiry">
                <Input type="date" value={t.passport_expiry} onChange={(e) => set(i, { passport_expiry: e.target.value })} aria-label={`Passport expiry ${i + 1}`} />
              </Field>
              <Field label="Nationality (2 letters)">
                <Input value={t.passport_nationality} maxLength={2} onChange={(e) => set(i, { passport_nationality: e.target.value.toUpperCase() })} aria-label={`Nationality ${i + 1}`} />
              </Field>
            </>
          )}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Email for the booking">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Booking email" />
        </Field>
        <Field label="Phone, with country code">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Booking phone" />
        </Field>
      </div>
      {needs.gst && <p className="m-0 text-xs text-warn">This fare needs GST details, which this test form does not send: TripJack may refuse it.</p>}
      {book.error && <ErrorNote error={book.error} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="accent" disabled={!review.hold_allowed || book.isPending} onClick={() => book.mutate("hold")}>
          {book.isPending && book.variables === "hold" ? "Holding…" : "Hold (no payment)"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={book.isPending || review.total == null}
          onClick={() => window.confirm(`Book and ticket now for ${inr(review.total ?? 0)} from the TripJack test wallet?`) && book.mutate("book")}
        >
          {book.isPending && book.variables === "book" ? "Booking…" : "Book now"}
        </Button>
        <Raw value={review.raw} label="the review" />
      </div>
    </div>
  );
}

/** A TripJack booking: status, PNRs, when a hold runs out, and ticket or release a hold. */
export function BookingCard({ bookingId, quoted }: { bookingId: string; quoted?: Price }) {
  const details = useQuery({
    queryKey: ["tripjack-booking", bookingId],
    queryFn: () => call<Booking>("GET", `bookings/${encodeURIComponent(bookingId)}`),
    // TripJack asks for about 5 seconds before reading a new booking; keep reading while pending.
    refetchInterval: (q) => (q.state.data?.status === "PENDING" || !q.state.data ? 5000 : false),
    retry: 1,
    retryDelay: 5000,
  });
  const b = details.data;
  const confirm = useMutation({
    mutationFn: () => call("POST", `bookings/${encodeURIComponent(bookingId)}/confirm`, { amount: b?.price.tripjack ?? quoted?.tripjack }),
    onSettled: () => details.refetch(),
  });
  const release = useMutation({
    mutationFn: () => call("POST", `bookings/${encodeURIComponent(bookingId)}/release`, { pnrs: b?.pnrs ?? [] }),
    onSettled: () => details.refetch(),
  });
  const deadlines = Object.entries(b?.hold_deadlines ?? {});

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border p-3 text-sm" data-testid="tripjack-booking">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Booking <code>{bookingId}</code></strong>
        {b?.status && <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status}</Badge>}
        <Button size="sm" variant="ghost" onClick={() => details.refetch()} disabled={details.isFetching}>{details.isFetching ? "Reading…" : "Refresh"}</Button>
      </div>
      {details.error && <ErrorNote error={details.error} />}
      {b && (
        <>
          <SupplierNote supplier={b.supplier} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>PNR {b.pnrs.length ? b.pnrs.join(", ") : "—"}</span>
            <span>Tickets {b.tickets.length ? b.tickets.join(", ") : "—"}</span>
            {b.created_on && <span>Made {b.created_on}</span>}
            {b.travellers.length > 0 && <span>{b.travellers.map((t) => t.name).join(", ")}</span>}
          </div>
          {b.price.tripjack != null ? (
            <PriceLine price={b.price} label={b.status === "ON_HOLD" ? "Hold price" : "Booking price"} note="from TripJack's booking" />
          ) : quoted ? (
            <PriceLine price={quoted} label={b.status === "ON_HOLD" ? "Hold price" : "Booking price"} note="as TripJack quoted it at review (its booking answer names no fare)" />
          ) : (
            <p className="m-0 text-xs text-warn">TripJack&apos;s booking answer names no fare. Open TripJack&apos;s answer below to see it.</p>
          )}
          {b.status === "ON_HOLD" && (
            <div className="rounded-md bg-warn-soft p-2 text-xs">
              <strong>Hold runs out:</strong>{" "}
              {deadlines.length ? (
                <ul className="m-0 mt-1 list-none p-0">
                  {deadlines.map(([k, v]) => <li key={k}><code>{k}</code> = {String(v)} {untilText(v) && <span className="text-muted">({untilText(v)})</span>}</li>)}
                </ul>
              ) : (
                "TripJack's answer names no deadline. Open TripJack's answer below to look for it."
              )}
            </div>
          )}
          {(confirm.error || release.error) && <ErrorNote error={confirm.error ?? release.error} />}
          <div className="flex flex-wrap items-center gap-2">
            {b.status === "ON_HOLD" && (
              <>
                <Button
                  size="sm"
                  variant="accent"
                  disabled={confirm.isPending || (b.price.tripjack ?? quoted?.tripjack) == null}
                  onClick={() => window.confirm(`Ticket this hold for ${inr(b.price.tripjack ?? quoted?.tripjack ?? 0)} from the TripJack test wallet?`) && confirm.mutate()}
                >
                  {confirm.isPending ? "Ticketing…" : "Ticket the hold"}
                </Button>
                <Button size="sm" variant="secondary" disabled={release.isPending} onClick={() => window.confirm("Release this hold?") && release.mutate()}>
                  {release.isPending ? "Releasing…" : "Release the hold"}
                </Button>
              </>
            )}
            <Raw value={b.raw} />
          </div>
        </>
      )}
    </div>
  );
}

/** Open any TripJack booking by its id (a hold made earlier, say). */
export function FindBooking() {
  const [text, setText] = useState("");
  const [id, setId] = useState<string | null>(null);
  return (
    <div className="p-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setId(text.trim() || null);
        }}
      >
        <Field label="Open a TripJack booking">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="TJS…" aria-label="TripJack booking id" />
        </Field>
        <Button type="submit" variant="secondary">Open</Button>
      </form>
      {id && <BookingCard key={id} bookingId={id} />}
    </div>
  );
}
