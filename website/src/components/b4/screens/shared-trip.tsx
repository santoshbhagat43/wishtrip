"use client";

import { useQuery } from "@tanstack/react-query";
import { BedDouble, Compass, Landmark, Utensils } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { partySize, partyText, samplePrices, type Party, type PublicTrip } from "../trip-journey";
import { useEffect, useState } from "react";

import { daysFromItems, type ItineraryDay } from "@/components/creator/itinerary-sheet";
import { api, unwrap } from "@/lib/api/client";
import { useMe } from "@/lib/session";

import { LINKS } from "../data";
import { FlightDialog } from "../flight-details";
import { StopDetailsDialog } from "../stop-details";
import { FlowHeader, Kicker, Why } from "../flow";
import { copyText } from "@/lib/clipboard";

const KIND_ICON: Record<string, typeof Landmark> = {
  sight: Landmark,
  food: Utensils,
  stay: BedDouble,
  experience: Compass,
  area: Compass,
  note: Landmark,
};

/** The kind of stop, as the trip board labels it. */
const KIND_CHIP: Record<string, { label: string; chip: string }> = {
  sight: { label: "See", chip: "bg-[#E6F3FB] text-[#1A6094]" },
  food: { label: "Eat", chip: "bg-[#FCE9ED] text-[#C43B58]" },
  stay: { label: "Stay", chip: "bg-[#F1EAF8] text-[#6A3FA0]" },
  experience: { label: "Experience", chip: "bg-[#FDF0D9] text-[#B86E00]" },
  area: { label: "Explore", chip: "bg-[#E3F5EE] text-[#0B7A57]" },
  note: { label: "Note", chip: "bg-[#F3F6F9] text-[#566E85]" },
};

/** What a traveller chose on the Details screen, when the trip is being made theirs. */
/** `code` is its own trip number; `source` is the creator's trip it was made from. */
export type Mine = { code: string; source: string; days: number; party: Party; pace: string; when?: string };

const BOOKING = "flex flex-col gap-2 rounded-[18px] border border-[#E3E8EE] bg-white p-3.5";

/** What the board says about each booking. The wording follows the prototype; the destination
 *  is the trip's own, and the prices are samples. */
function bookings(where: string, nights: number, prices: ReturnType<typeof samplePrices>) {
  return [
    {
      kind: "FLIGHTS",
      price: prices.flights,
      title: `Your city ⇄ ${where}`,
      detail: "Return · dates and seats at checkout",
      chip: "Cheapest, seats together",
    },
    {
      kind: "STAY",
      price: prices.stay,
      title: `A stay in ${where}`,
      detail: `${nights} ${nights === 1 ? "night" : "nights"} · rooms at checkout`,
      chip: "Ground floor on request",
      swap: "Swap this stay",
    },
    {
      kind: "TRANSFERS",
      price: prices.transfers,
      title: "Private car, same driver",
      detail: "Airport both ways + day trips",
      chip: "Short drives only",
    },
  ];
}

/**
 * A creator's shared trip (wishtrip…/t/<code>), laid out as the B4 trip board: bookings on the
 * board, the days from the creator's reel, one price, and Arya to change anything. The stops are
 * the creator's own; the bookings and prices are the prototype's samples until bookings are live.
 */
export function SharedTripScreen({ mine, preloaded }: { mine?: Mine; preloaded?: PublicTrip } = {}) {
  const params = useParams<{ code?: string }>();
  const code = mine?.source ?? params.code ?? "";
  const me = useMe();
  const trip = useQuery({
    queryKey: ["public-trip", code],
    retry: false,
    enabled: !preloaded,
    queryFn: async () => {
      const r = await api.GET("/trips/{share_code}", { params: { path: { share_code: code } } });
      return r.response.status === 404 ? null : unwrap(r);
    },
  });
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dayIx, setDayIx] = useState(0);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [flights, setFlights] = useState(false);

  // Credit the creator once we know who they are.
  const referralCode = (preloaded ?? trip.data)?.creator.referral_code;
  useEffect(() => {
    if (!referralCode) return;
    fetch("/api/creator-visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referralCode }),
    }).catch(() => {});
  }, [referralCode]);

  const name = me.data ? (me.data.full_name || me.data.email.split("@")[0]) : undefined;
  const header = (title: string, subtitle: string) => (
    <FlowHeader
      {...(mine ? { step: 2 } : { nav: true })}
      title={title}
      subtitle={subtitle}
      back={mine ? `${LINKS.details}?trip=${mine.source}&mine=${mine.code}` : LINKS.home}
      signedIn={!!me.data}
      traveller={name}
    />
  );

  if (!preloaded && trip.isLoading) {
    return (
      <div className="min-h-dvh bg-[#FFFFFF]">
        {header("Trip board", "Loading")}
        <p className="p-10 text-center text-[#566E85]">Loading the trip board…</p>
      </div>
    );
  }
  const t = preloaded ?? trip.data;
  if (!t) {
    return (
      <div className="min-h-dvh bg-[#FFFFFF]">
        {header("Trip board", "Not available")}
        <main className="mx-auto max-w-[640px] px-6 py-16">
          <h1 className="font-display text-[32px] font-medium leading-tight">This trip isn’t available</h1>
          <p className="mt-2 text-[#566E85]">The link may be wrong, or the creator unpublished it.</p>
          <Link href={LINKS.home} className="mt-6 inline-block rounded-full bg-[#22DDE0] px-6 py-3 text-base font-bold text-[#072338] no-underline">
            Explore wishtrip
          </Link>
        </main>
      </div>
    );
  }

  const who = t.creator.display_name || (t.creator.handle ? `@${t.creator.handle}` : "a creator");
  const where = t.destination_name || "your trip";
  const days = daysFromItems(t.items, mine?.days);
  const travellers = mine ? Math.max(1, partySize(mine.party)) : 3;
  const prices = samplePrices(travellers, mine ? Math.max(1, days.length - 1) : 4);
  const current = Math.min(dayIx, Math.max(0, days.length - 1));
  const day = days[current];
  const stops = days.reduce((n, d) => n + d.stops.length, 0);
  const seed = `Plan a trip to ${where}${mine ? ` for ${partyText(mine.party)}, ${mine.days} days, ${mine.pace} pace${mine.when ? `, ${mine.when}` : ""}` : ""}${
    t.items.length ? `. I want to see: ${t.items.filter((i) => i.kind !== "note").map((i) => i.name).slice(0, 10).join(", ")}` : ""
  }.`;
  const plan = (extra = "") => `${LINKS.start}?prompt=${encodeURIComponent(seed + extra)}`;
  const here = typeof window === "undefined" ? "" : window.location.href;

  return (
    <div className="min-h-dvh bg-[#FFFFFF] text-[#0D2436]">
      {header(mine ? `Your ${where} trip` : t.title, `${days.length} ${days.length === 1 ? "day" : "days"} · ${mine ? "made for you" : `by ${who}`}`)}

      <main className="mx-auto grid max-w-[1320px] grid-cols-1 items-start gap-7 px-4 pb-16 pt-6 md:grid-cols-[1fr_330px] md:px-10 md:pb-[72px] md:pt-8">
        <section className="flex min-w-0 flex-col gap-[22px]">
          <div className="relative isolate overflow-hidden rounded-[28px] bg-[#072338] text-white">
            {t.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- backend media
              <img src={t.cover_image_url} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
            ) : (
              <span className="absolute inset-0 -z-20 bg-gradient-to-br from-[#072338] to-[#0A7C80]" />
            )}
            <span className="absolute inset-0 -z-10 bg-gradient-to-r from-[#041A2C]/85 via-[#041A2C]/45 to-[#041A2C]/10" />
            <span className="absolute inset-0 -z-10 bg-gradient-to-t from-[#041A2C]/50 via-transparent to-transparent" />
            <div className="flex min-h-[230px] flex-col justify-end gap-2 p-6 md:min-h-[290px] md:p-9">
              {mine && (
                <span className="mb-1 inline-flex w-fit flex-wrap items-center gap-2 rounded-full bg-white/15 py-1 pl-3 pr-1.5 text-[12.5px] font-semibold text-white">
                  Trip no.{" "}
                  <strong className="font-mono tracking-wider">{`${mine.code.slice(0, 4)}-${mine.code.slice(4)}`.toUpperCase()}</strong>
                  <Link href={`${LINKS.details}?trip=${mine.source}&mine=${mine.code}`} className="rounded-full bg-white px-3 py-1 text-[#0A7C80] no-underline">
                    Change details
                  </Link>
                </span>
              )}
              <span className="text-[13px] font-bold text-[#22DDE0]">
                {mine ? `Made for you · based on ${who}’s trip` : `A trip by ${who}`}
              </span>
              <h1 className="font-display m-0 text-[36px] font-medium leading-[1.05] md:text-[56px]">{mine ? `Your ${where} trip` : t.title}</h1>
              <p className="m-0 text-[14.5px] text-white/90">
                {days.length} {days.length === 1 ? "day" : "days"} · {stops} stops
                {mine
                  ? ` · ${partyText(mine.party) || "1 traveller"} · ${mine.pace} pace${mine.when ? ` · ${mine.when}` : ""}`
                  : ` · ${days.reduce((n, d) => n + d.stops.filter((s) => s.origin === "reel").length, 0)} from ${who}’s reel`}
              </p>
              {t.summary && <p className="m-0 max-w-[640px] text-[14px] text-white/80">{t.summary}</p>}
              <div className="relative mt-2 flex gap-2">
                <button
                  type="button"
                  aria-expanded={sharing}
                  onClick={() => setSharing((open) => !open)}
                  className="rounded-full border-[1.5px] border-white/70 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Share with family
                </button>
                {sharing && (
                  <div
                    role="group"
                    aria-label="Share with family"
                    className="absolute left-0 top-[calc(100%+8px)] z-10 flex w-[300px] flex-col gap-2.5 rounded-2xl border border-[#E3E8EE] bg-white p-4 text-[#0D2436] shadow-lg"
                  >
                    <strong className="text-sm">Send it to the people coming with you</strong>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          copyText(here);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="flex-1 rounded-full bg-[#072338] px-3.5 py-2 text-[13px] font-semibold text-white"
                      >
                        {copied ? "Copied" : "Copy link"}
                      </button>
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(`${t.title} — ${here}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-full border-[1.5px] border-[#E3E8EE] px-3.5 py-2 text-center text-[13px] font-semibold text-[#0D2436] no-underline"
                      >
                        WhatsApp
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <Kicker>BOOKINGS ON YOUR BOARD</Kicker>
            <div className="grid gap-3 sm:grid-cols-3">
              {bookings(where, Math.max(1, days.length - 1), prices).map((b) => {
                const flight = b.kind === "FLIGHTS";
                const Tag = flight ? "button" : "div";
                return (
                <Tag
                  key={b.kind}
                  {...(flight ? { type: "button" as const, onClick: () => setFlights(true), "aria-haspopup": "dialog" as const } : {})}
                  className={`${BOOKING} ${flight ? "cursor-pointer text-left hover:border-[#0A7C80]" : ""}`}
                >
                  <span className="flex items-center justify-between">
                    <Kicker>{b.kind}</Kicker>
                    <strong className="text-sm tabular-nums">{b.price}</strong>
                  </span>
                  <strong className="text-[15px]">{b.title}</strong>
                  <span className="text-[12.5px] text-[#566E85]">{b.detail}</span>
                  <span className="flex flex-col items-start gap-1.5">
                    <Why>{b.chip}</Why>
                    {b.swap && <span className="text-[12.5px] font-semibold text-[#0A7C80]">{b.swap}</span>}
                    {flight && <span className="text-[12.5px] font-semibold text-[#0A7C80]">See live flights</span>}
                  </span>
                </Tag>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Kicker>DAY BY DAY</Kicker>
            <div role="tablist" aria-label="Days" className="flex gap-2.5 overflow-x-auto pb-1.5">
              {days.map((d: ItineraryDay, i) => {
                const on = i === current;
                const lead = d.stops.find((x) => x.image);
                const LeadIcon = KIND_ICON[d.stops[0]?.kind ?? "sight"] ?? Landmark;
                return (
                  <button
                    key={d.n}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setDayIx(i)}
                    className={`flex flex-none cursor-pointer items-center gap-3 rounded-2xl bg-white p-2 pr-4 text-left text-[#0D2436] ${
                      on ? "border-2 border-[#C43B58]" : "border border-[#E8EDF2] hover:border-[#C9D3DE]"
                    }`}
                  >
                    <span className="relative grid size-[46px] flex-none place-items-center overflow-hidden rounded-xl bg-[#F3F6F9] text-[#3F5A72]">
                      {lead?.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
                        <img src={lead.image} alt="" className="absolute inset-0 size-full object-cover" />
                      ) : (
                        <LeadIcon className="size-5" strokeWidth={1.7} />
                      )}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <strong className="text-[15px]">Day {d.n}</strong>
                      <span className="text-xs text-[#5F6B78]">
                        {d.stops.length} {d.stops.length === 1 ? "stop" : "stops"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {day && (
              <div role="tabpanel" aria-label={`Day ${day.n}`} className="flex flex-col gap-3">
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <span className="text-[12px] font-bold tracking-[.1em] text-[#C43B58]">DAY {day.n}</span>
                  <span className="text-[13px] text-[#5F6B78]">
                    {day.stops.length} {day.stops.length === 1 ? "plan" : "plans"}
                  </span>
                </div>
                <h2 className="m-0 -mt-1 mb-1 font-sans text-[26px] font-bold leading-tight tracking-tight md:text-[32px]">
                  {day.stops
                    .slice(0, 2)
                    .map((x) => x.name)
                    .join(" and ")}
                </h2>
                {day.stops.map((s, i) => {
                  const Icon = KIND_ICON[s.kind] ?? Landmark;
                  const kind = KIND_CHIP[s.kind] ?? KIND_CHIP.sight;
                  return (
                    <article key={`${s.name}-${i}`} className="relative flex overflow-hidden rounded-[22px] border border-[#E3E8EE] bg-white hover:border-[#0A7C80]">
                      <div className="relative grid w-[104px] flex-none place-items-center bg-gradient-to-br from-[#F3F6F9] to-[#E3F5F5] text-[#0A7C80] md:w-[240px]">
                        {s.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
                          <img src={s.image} alt={s.imageHotel ?? s.name} className="absolute inset-0 size-full object-cover" loading="lazy" />
                        ) : (
                          <Icon className="size-9 md:size-12" strokeWidth={1.4} />
                        )}
                        <span className="absolute left-3 top-3 rounded-full bg-[rgba(7,35,56,.85)] px-2.5 py-1 text-[11.5px] font-bold text-white">{s.when}</span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 md:p-5">
                        <span className={`w-fit rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${kind.chip}`}>{kind.label}</span>
                        <strong className="text-[18px] leading-snug md:text-[22px]">
                          {s.id ? (
                            <button type="button" aria-haspopup="dialog" onClick={() => setOpenStop(s.id!)} className="text-left after:absolute after:inset-0 after:content-['']">
                              {s.name}
                            </button>
                          ) : (
                            s.name
                          )}
                        </strong>
                        {s.image && s.imageHotel && (
                          <span className="-mt-1 text-[11.5px] text-[#5F6B78]">Photo: {s.imageHotel} · via TripJack</span>
                        )}
                        {s.kind === "stay" && !s.image && s.id && (
                          <span className="-mt-1 text-[12.5px] font-semibold text-[#B86E00]">No exact hotel match · see alternatives</span>
                        )}
                        {s.id && <span className="-mt-1 text-[12.5px] font-semibold text-[#0A7C80]">See details</span>}
                        <span className="flex flex-wrap items-center gap-1.5">
                          {s.origin === "suggested" ? (
                            <span className="inline-flex max-w-full items-center truncate rounded-full bg-[#EEF2F6] px-[9px] py-0.5 text-[10.5px] font-bold text-[#3F5A72]">
                              Wishtrip recommended
                            </span>
                          ) : (
                            <Why>
                              {s.origin === "kb"
                                ? "Checked by WishTrip"
                                : s.origin === "creator"
                                  ? "Added by the creator"
                                  : `From the reel${s.at ? ` · ${s.at}` : ""}`}
                            </Why>
                          )}
                          {s.note && <span className="rounded-full bg-[#F3F6F9] px-2.5 py-0.5 text-[11px] font-semibold text-[#566E85]">{s.note}</span>}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-3.5 md:sticky md:top-[100px]">
          <div className="flex flex-col gap-2.5 rounded-[22px] border border-[#E3E8EE] bg-white p-5">
            <Kicker>ONE PRICE, EVERYTHING IN</Kicker>
            {prices.rows.map(([label, price]) => (
              <span key={label} className="flex justify-between text-[13.5px] text-[#3F5A72]">
                <span>{label}</span>
                <span className="font-semibold tabular-nums text-[#0D2436]">{price}</span>
              </span>
            ))}
            <span className="mt-0.5 flex items-baseline justify-between border-t border-[#E8EDF2] pt-3">
              <strong className="text-[15px]">Total for {travellers}</strong>
              <strong className="text-[30px] tabular-nums">{prices.total}</strong>
            </span>
            <Link
              href={mine ? plan() : `${LINKS.details}?trip=${code}`}
              className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline shadow-[0_10px_26px_rgba(18,201,206,.3)]"
            >
              {mine ? "Book in one go" : "Make it mine"}
            </Link>
            <span className="text-center text-xs text-[#566E85]">Nothing is charged until you choose at checkout</span>
            <span className="text-center text-[11px] text-[#5F6B78]">Sample prices while bookings are being set up.</span>
          </div>

          <div className="flex flex-col gap-2.5 rounded-[22px] border border-[#E3E8EE] bg-white p-4">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="font-display grid size-[34px] flex-none place-items-center rounded-full text-[18px] font-semibold italic text-white"
                style={{ background: "linear-gradient(135deg,#22DDE0 0%,#1A6094 100%)" }}
              >
                A
              </span>
              <strong className="text-[15px]">Change anything with Arya</strong>
            </span>
            <span className="text-[13px] text-[#566E85]">Say it in your words. The board and the price update.</span>
            <span className="flex flex-wrap gap-1.5">
              {[
                ["Add a sunset cruise", ". Add a sunset cruise."],
                [`Make day ${Math.min(3, days.length)} easier`, `. Make day ${Math.min(3, days.length)} easier.`],
              ].map(([label, extra]) => (
                <Link
                  key={label}
                  href={plan(extra)}
                  className="rounded-full border-[1.5px] border-[#BDEFF0] px-[11px] py-[7px] text-[12.5px] font-semibold text-[#0A7C80] no-underline"
                >
                  {label}
                </Link>
              ))}
            </span>
          </div>
        </aside>
      </main>
      {openStop && <StopDetailsDialog code={code} itemId={openStop} onClose={() => setOpenStop(null)} />}
      {flights && <FlightDialog where={where} nights={Math.max(1, days.length - 1)} signedIn={!!me.data} onClose={() => setFlights(false)} />}
    </div>
  );
}
