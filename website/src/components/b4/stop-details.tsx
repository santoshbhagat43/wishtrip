"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api, unwrap, type Schemas } from "@/lib/api/client";

import { Modal } from "./modal";

type Hotel = Schemas["HotelDetail"];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const stars = (n?: number | null) => (n ? "★".repeat(Math.round(n)) : "");

function Gallery({ hotel }: { hotel: Hotel }) {
  const [ix, setIx] = useState(0);
  const shown = hotel.images[ix];
  if (!shown) return null;
  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo */}
      <img src={shown.url} alt={shown.caption || hotel.name} className="aspect-[16/9] w-full rounded-2xl bg-[#F3F6F9] object-cover" />
      {hotel.images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {hotel.images.map((img, i) => (
            <button key={img.url} type="button" aria-label={`Photo ${i + 1}`} aria-pressed={i === ix} onClick={() => setIx(i)} className={`size-16 flex-none overflow-hidden rounded-xl border-2 ${i === ix ? "border-[#0A7C80]" : "border-transparent"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo */}
              <img src={img.url} alt="" className="size-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HotelInfo({ hotel }: { hotel: Hotel }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <strong className="text-[20px] leading-tight">{hotel.name}</strong>
        <div className="text-[13px] text-[#566E85]">
          {stars(hotel.stars) && <span className="mr-2 text-[#B86E00]">{stars(hotel.stars)}</span>}
          {[hotel.property_type, hotel.address || [hotel.city, hotel.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
        </div>
      </div>
      {hotel.headline && <p className="m-0 text-[14.5px] font-medium">{hotel.headline}</p>}
      {hotel.description && <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-[#3F5A72]">{hotel.description}</p>}
      {hotel.amenities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hotel.amenities.map((a) => (
            <span key={a} className="rounded-full bg-[#F3F6F9] px-2.5 py-1 text-[12px] text-[#3F5A72]">{a}</span>
          ))}
        </div>
      )}
      <span className="text-[11.5px] text-[#5F6B78]">Photos and details from TripJack. Prices are shown at checkout.</span>
    </div>
  );
}

function Alternative({ alt }: { alt: Schemas["Alternative"] }) {
  const [open, setOpen] = useState(false);
  const h = alt.hotel;
  return (
    <article className="overflow-hidden rounded-2xl border border-[#E3E8EE]">
      <div className="flex gap-3 p-3">
        {h.images[0] && (
          // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
          <img src={h.images[0].url} alt="" className="size-24 flex-none rounded-xl bg-[#F3F6F9] object-cover" loading="lazy" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <strong className="text-[15.5px] leading-snug">{h.name}</strong>
          <span className="text-[12.5px] text-[#566E85]">
            {stars(h.stars) && <span className="mr-1.5 text-[#B86E00]">{stars(h.stars)}</span>}
            {h.address || h.city}
          </span>
          <span className="w-fit rounded-full bg-[#EEF2F6] px-2.5 py-0.5 text-[11px] font-bold text-[#3F5A72]">{alt.reason}</span>
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-auto w-fit text-[13px] font-semibold text-[#0A7C80]">
            {open ? "Hide details" : "See details"}
          </button>
        </div>
      </div>
      {open && <div className="flex flex-col gap-3 border-t border-[#E8EDF2] p-4"><Gallery hotel={h} /><HotelInfo hotel={h} /></div>}
    </article>
  );
}

/** One stop of a shared trip, in detail: the hotel behind a stay (or the closest alternatives when
 *  the reel's name matches none) and what WishTrip knows about a place. */
export function StopDetailsDialog({ code, itemId, onClose }: { code: string; itemId: string; onClose: () => void }) {
  const stop = useQuery({
    queryKey: ["stop", code, itemId],
    retry: false,
    queryFn: async () => unwrap(await api.GET("/trips/{share_code}/stops/{item_id}", { params: { path: { share_code: code, item_id: itemId } } })),
  });
  const s = stop.data;
  const facts = s?.place;
  const hasFacts = !!facts && !!(facts.summary || facts.description || facts.tips || facts.pros.length || facts.cons.length || facts.duration_minutes || facts.best_times.length || facts.price_note || facts.address);
  return (
    <Modal title={s?.name ?? "Details"} onClose={onClose}>
      {stop.isLoading && <p className="m-0 text-[#566E85]">Loading details…</p>}
      {stop.error && <p className="m-0 text-[#C43B58]">We couldn’t load the details for this stop.</p>}
      {s && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#566E85]">
            <span className="rounded-full bg-[#F3F6F9] px-2.5 py-0.5 font-bold capitalize">{s.kind === "stay" ? "Stay" : s.kind}</span>
            {s.origin === "reel" && s.at_seconds != null && <span>In the reel at {clock(s.at_seconds)}</span>}
            {s.origin === "kb" && <span>Checked by WishTrip</span>}
            {s.origin === "creator" && <span>Added by the creator</span>}
            {s.origin === "suggested" && <span>Wishtrip recommended</span>}
          </div>
          {s.note && <p className="m-0 rounded-2xl bg-[#F3F6F9] p-3.5 text-[14px] text-[#3F5A72]">{s.note}</p>}

          {s.hotel && (<><Gallery hotel={s.hotel} /><HotelInfo hotel={s.hotel} /></>)}

          {!s.hotel && s.alternatives.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-[#F2D9A6] bg-[#FDF0D9] p-3.5 text-[13.5px] text-[#7A4A00]">
                We couldn’t match “{s.name}” to a hotel we hold. These are the closest suggestions, not the creator’s pick.
              </div>
              {s.alternatives.map((alt) => <Alternative key={alt.hotel.id} alt={alt} />)}
            </div>
          )}
          {s.kind === "stay" && !s.hotel && s.alternatives.length === 0 && (
            <p className="m-0 text-[14px] text-[#566E85]">We don’t hold a hotel for this stay yet. Ask Arya for options.</p>
          )}

          {facts && hasFacts && (
            <div className="flex flex-col gap-3">
              {facts.summary && <p className="m-0 text-[15px] font-medium">{facts.summary}</p>}
              {facts.description && <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-[#3F5A72]">{facts.description}</p>}
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                {facts.duration_minutes != null && (<><dt className="text-[#566E85]">Time needed</dt><dd className="m-0">{facts.duration_minutes >= 60 ? `${Math.floor(facts.duration_minutes / 60)} h${facts.duration_minutes % 60 ? ` ${facts.duration_minutes % 60} min` : ""}` : `${facts.duration_minutes} min`}</dd></>)}
                {facts.best_times.length > 0 && (<><dt className="text-[#566E85]">Best time</dt><dd className="m-0 capitalize">{facts.best_times.join(", ")}</dd></>)}
                {facts.price_note && (<><dt className="text-[#566E85]">Cost</dt><dd className="m-0">{facts.price_note}</dd></>)}
                {facts.address && (<><dt className="text-[#566E85]">Where</dt><dd className="m-0">{facts.address}</dd></>)}
              </dl>
              {facts.pros.length > 0 && <ul className="m-0 list-disc pl-5 text-[13.5px] text-[#3F5A72]">{facts.pros.map((p) => <li key={p}>{p}</li>)}</ul>}
              {facts.cons.length > 0 && <ul className="m-0 list-disc pl-5 text-[13.5px] text-[#8A5A00]">{facts.cons.map((p) => <li key={p}>{p}</li>)}</ul>}
              {facts.tips && <p className="m-0 rounded-2xl bg-[#E3F5EE] p-3.5 text-[13.5px] text-[#0B5E44]"><strong>Good to know:</strong> {facts.tips}</p>}
              <span className="text-[11.5px] text-[#5F6B78]">From places WishTrip has checked.</span>
            </div>
          )}
          {s.kind !== "stay" && !hasFacts && !s.note && (
            <p className="m-0 text-[14px] text-[#566E85]">All we have for this stop is its name, from the creator’s trip. Ask Arya what to expect there.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
