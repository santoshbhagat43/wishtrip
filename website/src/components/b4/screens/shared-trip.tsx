"use client";

import { useQuery } from "@tanstack/react-query";
import { BedDouble, Compass, Landmark, Plane, Utensils } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { clock, inr, partySize, partyText, livePrices, samplePrices, useFlightPrice, useStayPrices, type Party, type FlightPrice, type PublicTrip } from "../trip-journey";
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
  travel: Plane,
};

/** The kind of stop, as the trip board labels it. */
const KIND_CHIP: Record<string, { label: string; chip: string }> = {
  sight: { label: "See", chip: "bg-[#E6F3FB] text-[#1A6094]" },
  food: { label: "Eat", chip: "bg-[#FCE9ED] text-[#C43B58]" },
  stay: { label: "Stay", chip: "bg-[#F1EAF8] text-[#6A3FA0]" },
  experience: { label: "Experience", chip: "bg-[#FDF0D9] text-[#B86E00]" },
  area: { label: "Explore", chip: "bg-[#E3F5EE] text-[#0B7A57]" },
  note: { label: "Note", chip: "bg-[#F3F6F9] text-[#566E85]" },
  travel: { label: "Travel", chip: "bg-[#E6F3FB] text-[#1A6094]" },
};

/** What a traveller chose on the Details screen, when the trip is being made theirs. */
/** `code` is its own trip number; `source` is the creator's trip it was made from. */
export type Mine = {
  code: string;
  source: string;
  /** The reel it was built from, when it came from one. */
  importId?: string | null;
  days: number;
  party: Party;
  pace: string;
  when?: string;
  /** Where they travel from, when they said. */
  originCity?: string;
  /** How the plan for this party is getting on: building, ready or failed, and what it is. */
  build?: { status: string; error: string; persona: string; aiBuilt: boolean; summary: string; tips: string[]; fromReel: boolean };
  /** Try the build again (when it failed). */
  retry?: () => void;
};

const PERSONA: Record<string, string> = {
  solo: "a solo traveller",
  couple: "a couple",
  family: "a family",
  elderly: "senior travellers",
  flexible: "a mixed group",
};

/** Where "Change details" goes: back to the Details screen of the trip or reel it was built from. */
const detailsHref = (m: Mine) =>
  m.importId ? `${LINKS.details}?id=${m.importId}&mine=${m.code}` : `${LINKS.details}?trip=${m.source}&mine=${m.code}`;

const BOOKING = "flex flex-col gap-2 rounded-[18px] border border-[#E3E8EE] bg-white p-3.5";

/** What the board says about each booking. The wording follows the prototype; the destination
 *  is the trip's own, and the prices are samples. */
const FLIGHT_WHY: Record<string, string> = {
  no_dates: "Add a start date to see the live fare",
  no_origin: "Add the city you fly from to see the live fare",
  no_airport: "No live fare for this destination yet",
  same_city: "You start where this trip is",
  unavailable: "No fare found for these dates",
  error: "Live fare not available right now",
};

function bookings(where: string, nights: number, prices: ReturnType<typeof samplePrices>, flight?: FlightPrice, from?: string, real?: ReturnType<typeof livePrices>) {
  const live = flight?.status === "priced" && flight.total != null;
  const seats = flight ? `${flight.adults} ${flight.adults === 1 ? "adult" : "adults"}${flight.children ? ` + ${flight.children} ${flight.children === 1 ? "child" : "children"}` : ""}` : "";
  return [
    {
      kind: "FLIGHTS",
      price: live ? inr(flight.total!) : real ? "Not priced" : prices.flights,
      title: `${from || "Your city"} ⇄ ${where}`,
      detail: live
        ? `Return · ${seats} · live from TripJack${flight.checked_at ? `, checked ${clock(flight.checked_at)}` : ""}`
        : "Return · dates and seats at checkout",
      chip: live ? `${flight.legs[0]?.airline || "Cheapest fare"} · ${flight.legs[0]?.stops ? `${flight.legs[0].stops} stop` : "direct"}` : (flight && FLIGHT_WHY[flight.status]) || "Cheapest, seats together",
    },
    {
      kind: "STAY",
      price: real ? real.rows[1][1].split(" · ")[0] : prices.stay,
      title: `A stay in ${where}`,
      detail: `${nights} ${nights === 1 ? "night" : "nights"} · rooms at checkout`,
      chip: "Ground floor on request",
      swap: "Swap this stay",
    },
    {
      kind: "TRANSFERS",
      price: real ? "At checkout" : prices.transfers,
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
  // Live hotel prices, once the plan is ready (the stays are final) and not while it is being made.
  const live = useStayPrices(mine?.build?.status === "ready" ? mine.code : null).data;
  const flightLive = useFlightPrice(mine?.build?.status === "ready" ? mine.code : null).data;
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
  const [opening, setOpening] = useState(false);
  const router = useRouter();

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
      back={mine ? detailsHref(mine) : LINKS.home}
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
  // A trip planned for the party has its own days; an older copy is spread over the days chosen.
  const days = daysFromItems(t.items, mine && !t.items.some((i) => i.slot) ? mine.days : undefined);
  const stayPrice = (id?: string) => (id ? live?.stays.find((p) => p.item_id === id.slice(0, 40)) : undefined);
  const travellers = mine ? Math.max(1, partySize(mine.party)) : 3;
  // Priced for who is going and the days they chose, exactly as the Details screen's estimate is.
  const nights = mine ? Math.max(1, mine.days - 1) : Math.max(1, days.length - 1);
  const prices = samplePrices(travellers, mine ? nights : 4);
  // On a trip made for the traveller, the card is the live flight and hotel prices when TripJack has any.
  const real = mine ? livePrices(flightLive, live, travellers) : null;
  const current = Math.min(dayIx, Math.max(0, days.length - 1));
  const day = days[current];
  const stops = days.reduce((n, d) => n + d.stops.length, 0);
  const seed = `Plan a trip to ${where}${mine ? ` for ${partyText(mine.party)}, ${mine.days} days, ${mine.pace} pace${mine.when ? `, ${mine.when}` : ""}` : ""}${
    t.items.length ? `. I want to see: ${t.items.filter((i) => i.kind !== "note").map((i) => i.name).slice(0, 10).join(", ")}` : ""
  }.`;
  const plan = (extra = "") => `${LINKS.start}?prompt=${encodeURIComponent(seed + extra)}`;
  /** On a trip made for the traveller: a chat that already holds the board (who, days, pace, stops),
   *  with Arya sent the board to plan from. Signed out, it falls back to the sign-in redirect. */
  async function chatWithArya(extra = "") {
    if (!mine || opening) return;
    setOpening(true);
    const r = await api.POST("/my-trips/{code}/arya", { params: { path: { code: mine.code } } });
    if (r.error !== undefined || !r.data) {
      router.push(plan(extra ? `. ${extra}` : ""));
      return;
    }
    const message = [r.data.message, extra].filter(Boolean).join(" ");
    router.push(`${LINKS.start}?session=${r.data.session_id}&send=${encodeURIComponent(message)}`);
  }
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
                  <Link href={detailsHref(mine)} className="rounded-full bg-white px-3 py-1 text-[#0A7C80] no-underline">
                    Change details
                  </Link>
                </span>
              )}
              <span className="text-[13px] font-bold text-[#22DDE0]">
                {mine ? (mine.build?.fromReel ? "Made for you · from your reel" : `Made for you · based on ${who}’s trip`) : `A trip by ${who}`}
              </span>
              <h1 className="font-display m-0 text-[36px] font-medium leading-[1.05] md:text-[56px]">{mine ? `Your ${where} trip` : t.title}</h1>
              <p className="m-0 text-[14.5px] text-white/90">
                {days.length} {days.length === 1 ? "day" : "days"} · {stops} stops
                {mine
                  ? ` · ${partyText(mine.party) || "1 traveller"} · ${mine.pace} pace${mine.when ? ` · ${mine.when}` : ""}${mine.originCity ? ` · from ${mine.originCity}` : ""}`
                  : ` · ${days.reduce((n, d) => n + d.stops.filter((s) => s.origin === "reel").length, 0)} from ${who}’s reel`}
              </p>
              {(mine?.build?.summary || t.summary) && (
                <p className="m-0 max-w-[640px] text-[14px] text-white/80">{mine?.build?.summary || t.summary}</p>
              )}
              {mine?.build?.status === "ready" && mine.build.persona && (
                <span className="text-[12.5px] text-white/70">
                  Planned for {PERSONA[mine.build.persona] ?? "your group"} · {mine.build.aiBuilt ? "planned with AI, checked against the places in the reel" : "arranged from the places in the reel"}
                </span>
              )}
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
              {bookings(where, nights, prices, flightLive, mine?.originCity, real).map((b) => {
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

          {mine?.build?.status === "building" && (
            <div role="status" className="flex items-center gap-3 rounded-[18px] border border-[#BDEFF0] bg-[#F1FCFC] p-4 text-[14px]">
              <span className="size-4 flex-none animate-spin rounded-full border-2 border-[#0A7C80] border-t-transparent" aria-hidden="true" />
              <span>
                <strong className="block">Building your trip…</strong>
                <span className="text-[#566E85]">We’re planning each day for {PERSONA[mine.build.persona] ?? "your group"}, around the places in it. This takes a moment.</span>
              </span>
            </div>
          )}
          {mine?.build?.status === "failed" && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#F2C9C4] bg-[#FDF3F2] p-4 text-[14px]">
              <span>
                <strong className="block">We couldn’t build your trip just now</strong>
                <span className="text-[#566E85]">The places are shown as they are. Try again, or change the details.</span>
              </span>
              {mine.retry && (
                <button type="button" onClick={mine.retry} className="cursor-pointer rounded-full bg-[#072338] px-4 py-2 text-sm font-semibold text-white">
                  Try again
                </button>
              )}
            </div>
          )}

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
                        {s.kind === "stay" && (() => {
                          const p = stayPrice(s.id);
                          if (!p) return null;
                          if (p.status === "not_matched") {
                            if (!p.alternatives?.length) return null;
                            return (
                              <span className="flex flex-col gap-1 rounded-xl bg-[#F3F6F9] p-2.5 text-[12.5px] text-[#3F5A72]">
                                <strong className="text-[12px]">Not the hotel in the reel · closest with a room, live from TripJack</strong>
                                {p.alternatives.map((a) => (
                                  <span key={a.hotel.id} className="flex justify-between gap-2">
                                    <span className="min-w-0 truncate">{a.hotel.name}{a.stars ? ` · ${a.stars}★` : ""}</span>
                                    <span className="flex-none font-bold tabular-nums text-[#0D2436]">{inr(a.total)}{p.nights ? ` · ${p.nights} ${p.nights === 1 ? "night" : "nights"}` : ""}</span>
                                  </span>
                                ))}
                                <span className="text-[11px]">Suggestions only: they are not in your total.</span>
                              </span>
                            );
                          }
                          if (p.status === "priced")
                            return (
                              <span className="-mt-1 text-[13px] font-bold text-[#0B7A57]">
                                {inr(p.total ?? 0)} for {p.nights} {p.nights === 1 ? "night" : "nights"}
                                <span className="font-semibold text-[#5F6B78]">
                                  {p.meal_basis ? ` · ${p.meal_basis}` : ""} · live from TripJack{p.checked_at ? `, checked ${clock(p.checked_at)}` : ""}
                                </span>
                              </span>
                            );
                          const why: Record<string, string> = {
                            no_dates: "Add a start date to see the live price",
                            unavailable: "No room at this hotel for these dates",
                            error: "Live price not available right now",
                          };
                          return <span className="-mt-1 text-[12.5px] font-semibold text-[#B86E00]">{why[p.status] ?? ""}</span>;
                        })()}
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
                          {s.optional && <span className="rounded-full border border-[#BDEFF0] px-2.5 py-0.5 text-[10.5px] font-bold text-[#0A7C80]">Optional</span>}
                          {s.note && <span className="rounded-full bg-[#F3F6F9] px-2.5 py-0.5 text-[11px] font-semibold text-[#566E85]">{s.note}</span>}
                        </span>
                        {s.transfer && <span className="text-[12px] text-[#5F6B78]">Next: {s.transfer}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {mine?.build?.status === "ready" && mine.build.tips.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-[22px] border border-[#E3E8EE] bg-[#F9FBFC] p-5">
              <Kicker>GOOD TO KNOW</Kicker>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] text-[#3F5A72]">
                {mine.build.tips.map((tip) => (
                  <li key={tip} className="flex gap-2"><span aria-hidden="true">•</span><span>{tip}</span></li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-3.5 md:sticky md:top-[100px]">
          <div className="flex flex-col gap-2.5 rounded-[22px] border border-[#E3E8EE] bg-white p-5">
            <Kicker>ONE PRICE, EVERYTHING IN</Kicker>
            {(real ?? prices).rows.map(([label, price]) => (
              <span key={label} className="flex justify-between text-[13.5px] text-[#3F5A72]">
                <span>{label}</span>
                <span className="font-semibold tabular-nums text-[#0D2436]">{price}</span>
              </span>
            ))}
            <span className="mt-0.5 flex items-baseline justify-between border-t border-[#E8EDF2] pt-3">
              <strong className="text-[15px]">{real ? `${real.complete ? "Total" : "Total so far"} for ${travellers}` : `Total for ${travellers}`}</strong>
              <strong className="text-[30px] tabular-nums">{real?.total ?? prices.total}</strong>
            </span>
            {mine ? (
              <button
                type="button"
                disabled={opening}
                onClick={() => chatWithArya("I'd like to book this.")}
                className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] shadow-[0_10px_26px_rgba(18,201,206,.3)] disabled:opacity-60"
              >
                Book in one go
              </button>
            ) : (
              <Link
                href={`${LINKS.details}?trip=${code}`}
                className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338] no-underline shadow-[0_10px_26px_rgba(18,201,206,.3)]"
              >
                Make it mine
              </Link>
            )}
            <span className="text-center text-xs text-[#566E85]">Nothing is charged until you choose at checkout</span>
            <span className="text-center text-[11px] text-[#5F6B78]">
              {real
                ? `Live from TripJack${real.checkedAt ? `, checked ${clock(real.checkedAt)}` : ""}, taxes included. Experiences, meals and transfers are priced at checkout.`
                : "Sample prices while bookings are being set up."}
            </span>
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
                ["Add a sunset cruise", "Add a sunset cruise."],
                [`Make day ${Math.min(3, days.length)} easier`, `Make day ${Math.min(3, days.length)} easier.`],
              ].map(([label, extra]) =>
                mine ? (
                  <button
                    key={label}
                    type="button"
                    disabled={opening}
                    onClick={() => chatWithArya(extra)}
                    className="rounded-full border-[1.5px] border-[#BDEFF0] px-[11px] py-[7px] text-[12.5px] font-semibold text-[#0A7C80] disabled:opacity-60"
                  >
                    {label}
                  </button>
                ) : (
                  <Link
                    key={label}
                    href={plan(`. ${extra}`)}
                    className="rounded-full border-[1.5px] border-[#BDEFF0] px-[11px] py-[7px] text-[12.5px] font-semibold text-[#0A7C80] no-underline"
                  >
                    {label}
                  </Link>
                ),
              )}
            </span>
            {mine && (
              <button
                type="button"
                disabled={opening}
                onClick={() => chatWithArya()}
                className="rounded-full bg-[#072338] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {opening ? "Opening Arya…" : "Chat with Arya"}
              </button>
            )}
          </div>
        </aside>
      </main>
      {openStop && <StopDetailsDialog code={code} itemId={openStop} onClose={() => setOpenStop(null)} />}
      {flights && <FlightDialog where={where} nights={Math.max(1, days.length - 1)} signedIn={!!me.data} onClose={() => setFlights(false)} />}
    </div>
  );
}
