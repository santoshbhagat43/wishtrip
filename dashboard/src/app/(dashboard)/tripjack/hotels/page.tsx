"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import { SupplierNote } from "@/components/tripjack/supplier-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { inr, plusDays, today, type HotelCard, type HotelDetail, type HotelOption, type HotelSearchResult } from "@/lib/tripjack";

type Place = { region_id: number; city: string; country: string; name: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/backend${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: { msg: string }) => d.msg).join("; ") : "The search failed");
  }
  return data as T;
}

const nights = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));

/** Search TripJack hotels live: pick a city and dates, see each hotel's cheapest bookable price as
 *  travellers would (our markup included), and open a hotel for every room option. */
export default function TripJackHotelsPage() {
  const [text, setText] = useState("");
  const typed = useDeferredValue(text.trim());
  const [place, setPlace] = useState<Place | null>(null);
  const [checkIn, setCheckIn] = useState(plusDays(30));
  const [checkOut, setCheckOut] = useState(plusDays(32));
  const [adults, setAdults] = useState(2);
  const [kids, setKids] = useState("");
  const [sort, setSort] = useState<"price" | "rank">("price");
  const [open, setOpen] = useState<HotelCard | null>(null);

  const places = useQuery({
    queryKey: ["tj-places", typed],
    enabled: typed.length >= 2 && place?.city.toLowerCase() !== typed.toLowerCase(),
    queryFn: async () => {
      const res = await fetch(`/api/backend/hotels/destinations?q=${encodeURIComponent(typed)}&limit=8`);
      return (res.ok ? await res.json() : []) as Place[];
    },
  });
  const ages = kids.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 17);
  const room = { adults, child_ages: ages };
  const search = useMutation({
    mutationFn: () => post<HotelSearchResult>("/hotels/search", { region_id: place!.region_id, check_in: checkIn, check_out: checkOut, rooms: [room], sort }),
  });
  const result = search.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="TripJack hotels"
        description="Search a city live and see each hotel's cheapest price for your dates, as travellers would. Open a hotel for every room option."
      />
      <Card>
        <form
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (place) search.mutate();
          }}
        >
          <div className="relative sm:col-span-2">
            <Field label="Where" hint={place ? `${place.name}` : "Type a city and pick it from the list."}>
              <Input
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPlace(null);
                }}
                placeholder="e.g. Goa, Dubai, Ubud…"
                aria-label="Where"
                autoComplete="off"
              />
            </Field>
            {!place && places.data && places.data.length > 0 && (
              <ul role="listbox" aria-label="Cities" className="absolute left-0 right-0 top-[calc(100%-4px)] z-10 m-0 max-h-64 list-none overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card">
                {places.data.map((p) => (
                  <li key={p.region_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        setPlace(p);
                        setText(p.city);
                      }}
                    >
                      <strong>{p.city}</strong> <span className="text-muted">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Field label="Check in">
            <Input type="date" min={today()} value={checkIn} required onChange={(e) => { setCheckIn(e.target.value); if (checkOut <= e.target.value) setCheckOut(plusDays(1)); }} aria-label="Check in" />
          </Field>
          <Field label="Check out">
            <Input type="date" min={checkIn} value={checkOut} required onChange={(e) => setCheckOut(e.target.value)} aria-label="Check out" />
          </Field>
          <Field label="Adults">
            <Input type="number" min={1} max={6} value={adults} onChange={(e) => setAdults(Number(e.target.value) || 1)} aria-label="Adults" />
          </Field>
          <Field label="Children's ages" hint="Comma separated, e.g. 4, 9">
            <Input value={kids} onChange={(e) => setKids(e.target.value)} placeholder="none" aria-label="Children's ages" />
          </Field>
          <Field label="Sort by">
            <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="price">Cheapest first</option>
              <option value="rank">Best presented first</option>
            </Select>
          </Field>
          <div className="flex items-end lg:justify-end">
            <Button type="submit" variant="accent" disabled={!place || search.isPending}>{search.isPending ? "Searching TripJack…" : "Search hotels"}</Button>
          </div>
        </form>
      </Card>

      <div className="mt-5">
        {search.isPending && <Spinner />}
        {search.error && <ErrorNote error={search.error} />}
        {result && (
          <Card>
            <SupplierNote supplier={result.supplier} />
            {result.hotels.length === 0 ? (
              <p className="m-0 p-8 text-center text-sm text-muted">No hotel in {place?.city} has a room for those dates.</p>
            ) : (
              <>
                <p className="m-0 border-b border-border px-4 py-2.5 text-sm text-muted">
                  {result.total} hotels with rooms in {result.region?.city ?? place?.city} · {nights(checkIn, checkOut)} {nights(checkIn, checkOut) === 1 ? "night" : "nights"}, total price for the stay
                  {result.partial && <span className="ml-2 text-warn">Some of TripJack&apos;s answers were missing, so this list may be incomplete.</span>}
                </p>
                <ul className="m-0 grid list-none gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {result.hotels.map((h) => <HotelTile key={h.hotel_id} hotel={h} onOpen={() => setOpen(h)} />)}
                </ul>
              </>
            )}
          </Card>
        )}
      </div>
      {open && <HotelDialog hotel={open} query={{ check_in: checkIn, check_out: checkOut, rooms: [room] }} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HotelTile({ hotel: h, onOpen }: { hotel: HotelCard; onOpen: () => void }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-surface" data-testid="hotel-card">
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer text-left">
        <span className="relative block aspect-[16/10] bg-surface-2">
          {h.hero_image && (
            // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
            <img src={h.hero_image} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
          )}
        </span>
        <span className="flex flex-col gap-1 p-3.5">
          <strong className="line-clamp-1">{h.name}</strong>
          <span className="text-xs text-muted">{h.stars ? `${"★".repeat(Math.round(h.stars))} · ` : ""}{h.property_type || "Hotel"}</span>
          <span className="line-clamp-1 text-xs text-muted">{h.address}</span>
          <span className="mt-1 flex items-end justify-between gap-2">
            <span className="text-xs text-muted">{h.option.meal_basis || "Room only"}{h.option.cancellation.refundable ? " · refundable" : ""}</span>
            <strong className="text-lg tabular-nums">{inr(h.option.price.total)}</strong>
          </span>
        </span>
      </button>
    </li>
  );
}

function HotelDialog({ hotel, query, onClose }: { hotel: HotelCard; query: { check_in: string; check_out: string; rooms: unknown[] }; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["tj-hotel", hotel.hotel_id, query],
    queryFn: () => post<HotelDetail>(`/hotels/${hotel.hotel_id}/pricing`, query),
  });
  const d = detail.data;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={hotel.name} className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="m-0 text-lg font-semibold">{hotel.name}</h2>
            <p className="m-0 text-sm text-muted">{hotel.address}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="overflow-y-auto">
          {detail.isLoading && <Spinner />}
          {detail.error && <div className="p-4"><ErrorNote error={detail.error} /></div>}
          {d && (
            <>
              <SupplierNote supplier={d.supplier} />
              {d.hotel.images && d.hotel.images.length > 0 && (
                <div className="flex gap-2 overflow-x-auto p-4">
                  {d.hotel.images.slice(0, 8).map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
                    <img key={img.url} src={img.url} alt={img.caption} className="h-28 w-44 flex-none rounded-xl object-cover" loading="lazy" />
                  ))}
                </div>
              )}
              {d.hotel.headline && <p className="m-0 px-5 pb-3 text-sm text-muted">{d.hotel.headline}</p>}
              <h3 className="m-0 px-5 pb-2 text-sm font-semibold">{d.options.length} {d.options.length === 1 ? "room option" : "room options"}, cheapest first</h3>
              <ul className="m-0 flex list-none flex-col gap-2 px-5 pb-5">
                {d.options.map((o) => <OptionRow key={o.option_id} option={o} />)}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OptionRow({ option: o }: { option: HotelOption }) {
  const free = o.cancellation.free_until ? new Date(o.cancellation.free_until).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
  return (
    <li className="rounded-xl border border-border p-3 text-sm" data-testid="room-option">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span>
          <strong>{o.rooms.map((r) => r.name).join(" + ") || "Room"}</strong>
          <span className="block text-xs text-muted">{o.meal_basis || "Room only"}{o.inclusions.length ? ` · ${o.inclusions.join(", ")}` : ""}</span>
        </span>
        <span className="text-right">
          <strong className="text-base tabular-nums">{inr(o.price.total)}</strong>
          <span className="block text-xs text-muted tabular-nums">
            base {inr(o.price.base)} + taxes {inr(o.price.taxes)}{o.price.management_fee ? ` + fee ${inr(o.price.management_fee + (o.price.management_fee_tax ?? 0))}` : ""}
          </span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={o.cancellation.refundable ? "ok" : "danger"}>{o.cancellation.refundable ? (free ? `Free cancellation until ${free}` : "Refundable") : "Non-refundable"}</Badge>
        {o.needs_pan && <Badge tone="warn">PAN needed</Badge>}
        {o.needs_passport && <Badge tone="warn">Passport needed</Badge>}
        {o.booking_notes && <span className="text-muted">{o.booking_notes}</span>}
      </div>
    </li>
  );
}
