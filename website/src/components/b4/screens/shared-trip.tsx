"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, BedDouble, Car, Compass, Landmark, LogOut, Pencil, Plane, Sparkles, Utensils } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { clock, inr, partySize, partyText, livePrices, useFlightPrice, useStayPrices, type Party, type PublicTrip } from "../trip-journey";
import { useEffect, useState } from "react";

import { daysFromItems, type ItineraryDay, type Stop } from "@/components/creator/itinerary-sheet";
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
  /** The day they leave (yyyy-mm-dd), when they said: each day of the board gets its date. */
  start?: string;
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

/** Why there is no live fare, in the traveller's words. */
const FLIGHT_WHY: Record<string, string> = {
  no_dates: "Add your dates to see the live fare",
  no_origin: "Add the city you fly from to see the live fare",
  no_airport: "No live fare for this destination yet",
  same_city: "You start where this trip is",
  unavailable: "No fare found for these dates",
  error: "Live fare not available right now",
};

const ARRIVING = /^fly\b(?!.*\bback\b)(?!.*\bhome\b)/i;
const LEAVING = /^fly (back|home)\b/i;
const CARD = "relative overflow-hidden rounded-[22px] border border-[#E3E8EE] bg-white";

const DAY_MS = 86_400_000;
/** "Fri 30 Oct" for the trip's nth day (from 0), from the day they leave. */
const dayDate = (start: string, n: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + n * DAY_MS).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "3:55 pm" from TripJack's local "2026-10-30T15:55". */
const at = (iso?: string | null) => {
  const m = iso?.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
};
const places = (name: string) => {
  const m = name.match(/^fly(?: back| home)?(?: (.+?))? to (.+)$/i);
  return { from: m?.[1] ?? "", to: m?.[2] ?? "" };
};

/**
 * A trip board, as in the B4 prototype's "Your trip board": the trip at the top, the days as tabs,
 * each day's cards in the order it is lived (the flight, the road, the stay, the places), the live
 * price beside it, and Arya to change anything. On a creator's shared trip (wishtrip…/t/<code>) the
 * stops are the creator's own and there is no price until the traveller makes it theirs.
 */
export function SharedTripScreen({ mine, preloaded }: { mine?: Mine; preloaded?: PublicTrip } = {}) {
  const params = useParams<{ code?: string }>();
  const code = mine?.source ?? params.code ?? "";
  const me = useMe();
  // Live hotel prices, once the plan is ready (the stays are final) and not while it is being made.
  const stayAsk = useStayPrices(mine?.build?.status === "ready" ? mine.code : null);
  const flightAsk = useFlightPrice(mine?.build?.status === "ready" ? mine.code : null);
  const live = stayAsk.data;
  const flightLive = flightAsk.data;
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
  const [included, setIncluded] = useState(false);
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
  const travellers = mine ? Math.max(1, partySize(mine.party)) : 0;
  // On a trip made for the traveller, the card is the live flight and hotel prices when TripJack has any.
  const real = mine ? livePrices(flightLive, live, travellers) : null;
  // No figure without TripJack's answer: what the board is waiting for, in words.
  const checking = !!mine && (mine.build?.status !== "ready" || stayAsk.isLoading || flightAsk.isLoading);
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
    if (!mine) return router.push(plan(extra ? `. ${extra}` : ""));
    if (opening) return;
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
  const dateOf = (i: number) => (mine?.start ? dayDate(mine.start, i) : "");
  const firstDate = mine?.start ? dayDate(mine.start, 0) : "";
  const lastDate = mine?.start ? dayDate(mine.start, Math.max(0, (mine.days || days.length) - 1)) : "";
  const easier = Math.min(3, days.length);

  /** The flight on the day they fly in or home: TripJack's live leg when there is one. */
  const flightCard = (s: Stop, key: string) => {
    const back = LEAVING.test(s.name);
    const leg = flightLive?.status === "priced" ? flightLive.legs[back ? flightLive.legs.length - 1 : 0] : undefined;
    const said = places(s.name);
    const fromCity = back ? where : mine?.originCity || said.from || "Your city";
    const toCity = back ? said.to || mine?.originCity || "Home" : said.to || where;
    const why = checking ? "Checking live fares with TripJack…" : flightLive ? FLIGHT_WHY[flightLive.status] : "";
    return (
      <article key={key} className="flex flex-col gap-3 rounded-[22px] bg-[#0B2A45] p-5 text-white md:p-6">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[12px]">
          <strong className="tracking-[.12em] text-[#22DDE0]">FLIGHT{leg?.departs ? ` · ${at(leg.departs)}` : ""}</strong>
          {leg && <span className="text-white/85">{leg.airline} · {leg.flight_number}</span>}
          <span className="ml-auto rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/80">{s.when}</span>
        </span>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px] text-white/75">{fromCity}</span>
            <strong className="text-[28px] leading-none tracking-tight md:text-[32px]">{leg?.from_code ?? "—"}</strong>
            {leg?.departs && <strong className="mt-1 text-[14px]">{at(leg.departs)}</strong>}
          </span>
          <span className="flex flex-col items-center pb-1 text-[12px] text-white/75">
            <Plane className="size-4" aria-hidden="true" />
            {leg ? (leg.stops ? `${leg.stops} ${leg.stops === 1 ? "stop" : "stops"}` : "Direct") : ""}
          </span>
          <span className="flex min-w-0 flex-col items-end text-right">
            <span className="truncate text-[12.5px] text-white/75">{toCity}</span>
            <strong className="text-[28px] leading-none tracking-tight md:text-[32px]">{leg?.to_code ?? "—"}</strong>
            {leg?.arrives && <strong className="mt-1 text-[14px]">{at(leg.arrives)}</strong>}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
          <span className="text-[12.5px] text-white/80">
            {leg && flightLive?.total != null
              ? back
                ? "In your return fare · live from TripJack"
                : `Return fare for ${flightLive.adults} ${flightLive.adults === 1 ? "adult" : "adults"}${flightLive.children ? ` + ${flightLive.children} ${flightLive.children === 1 ? "child" : "children"}` : ""} · live from TripJack${flightLive.checked_at ? `, checked ${clock(flightLive.checked_at)}` : ""}`
              : mine
                ? why || s.name
                : "Live fare once you make this trip yours"}
          </span>
          <span className="flex items-center gap-3">
            {leg && !back && flightLive?.total != null && <strong className="text-[20px] tabular-nums">{inr(flightLive.total)}</strong>}
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setFlights(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3.5 py-2 text-[13px] font-bold text-white hover:bg-white/20"
            >
              <ArrowLeftRight className="size-3.5" aria-hidden="true" /> {leg ? "Flight options" : "See live flights"}
            </button>
          </span>
        </div>
      </article>
    );
  };

  /** A drive (to the hotel, to the next town, between the day's stops): what it is, never a price. */
  const roadCard = (s: Stop, key: string) => {
    const m = s.name.match(/^(?:travel from )?(.+?) to (.+?)(?: via (.+))?$/i);
    return (
      <article key={key} className={`${CARD} flex flex-col gap-2 p-5`}>
        <span className="flex flex-wrap items-baseline gap-x-2.5 text-[12px]">
          <strong className="tracking-[.12em] text-[#1A6094]">BY ROAD · {s.when.toUpperCase()}</strong>
          {m?.[3] && <span className="text-[#566E85]">via {m[3]}</span>}
        </span>
        {m && !/^getting around/i.test(s.name) ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <strong className="truncate text-[20px] leading-tight md:text-[24px]">{m[1]}</strong>
            <Car className="size-5 text-[#C43B58]" aria-hidden="true" />
            <strong className="truncate text-right text-[20px] leading-tight md:text-[24px]">{m[2]}</strong>
          </div>
        ) : (
          <strong className="text-[18px] leading-snug">{s.name}</strong>
        )}
        <span className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#E3E8EE] pt-2.5 text-[12.5px] text-[#566E85]">
          <span className="min-w-0">{s.note}</span>
          <span className="font-semibold text-[#3F5A72]">Arranged at checkout</span>
        </span>
      </article>
    );
  };

  /** A short line in the day (check out): no card of its own. */
  const noteRow = (s: Stop, key: string) => (
    <div key={key} className="flex items-center gap-4 rounded-[18px] border border-dashed border-[#D5DDE6] px-5 py-3.5 text-[14px]">
      <LogOut className="size-4 flex-none text-[#566E85]" aria-hidden="true" />
      <strong className="flex-none">{s.when}</strong>
      <span className="text-[#3F5A72]">
        <strong className="font-semibold text-[#0D2436]">{s.name}</strong>
        {s.note ? ` · ${s.note}` : ""}
      </span>
    </div>
  );

  /** A place in the day (a stay, a sight, a meal, an experience): its photo, what it is, and why. */
  const placeCard = (s: Stop, key: string, dayN: number) => {
    const Icon = KIND_ICON[s.kind] ?? Landmark;
    const kind = KIND_CHIP[s.kind] ?? KIND_CHIP.sight;
    const p = s.kind === "stay" ? stayPrice(s.id) : undefined;
    return (
      <article key={key} className={`${CARD} flex flex-col sm:flex-row`}>
        <div className="relative grid h-[150px] flex-none place-items-center bg-gradient-to-br from-[#F3F6F9] to-[#E3F5F5] text-[#0A7C80] sm:h-auto sm:min-h-[196px] sm:w-[260px] md:w-[300px]">
          {s.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
            <img src={s.image} alt={s.imageHotel ?? s.name} className="absolute inset-0 size-full object-cover" loading="lazy" />
          ) : (
            <Icon className="size-10 md:size-12" strokeWidth={1.4} aria-hidden="true" />
          )}
          <span className="absolute left-3 top-3 rounded-full bg-[rgba(7,35,56,.85)] px-2.5 py-1 text-[11.5px] font-bold text-white">{s.when}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 md:p-5">
          <span className="flex items-start justify-between gap-3">
            <span className={`mt-1 w-fit rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${kind.chip}`}>{kind.label}</span>
            <button
              type="button"
              disabled={opening}
              onClick={() => chatWithArya(`On day ${dayN}, change "${s.name}".`)}
              aria-label={`Ask Arya to change ${s.name}`}
              className="relative z-10 grid size-10 flex-none place-items-center rounded-full border border-[#E3E8EE] bg-white text-[#7A4E9A] hover:border-[#7A4E9A] disabled:opacity-60"
            >
              <Sparkles className="size-4" aria-hidden="true" />
            </button>
          </span>
          <strong className="text-[19px] leading-snug md:text-[22px]">{s.kind === "stay" && p?.hotel ? `Check in · ${p.hotel.name}` : s.name}</strong>
          {s.image && s.imageHotel && <span className="-mt-1 text-[11.5px] text-[#5F6B78]">Photo: {s.imageHotel} · via TripJack</span>}
          {s.note && <span className="text-[14px] text-[#566E85]">{s.note}</span>}
          {s.kind === "stay" && stayLine(p)}
          <span className="flex flex-wrap items-center gap-1.5">
            {s.origin === "suggested" ? (
              <span className="inline-flex max-w-full items-center truncate rounded-full bg-[#EEF2F6] px-[9px] py-0.5 text-[10.5px] font-bold text-[#3F5A72]">
                Wishtrip recommended
              </span>
            ) : (
              <Why>
                {s.origin === "kb" ? "Checked by WishTrip" : s.origin === "creator" ? "Added by the creator" : `From the reel${s.at ? ` · ${s.at}` : ""}`}
              </Why>
            )}
            {s.optional && <span className="rounded-full border border-[#BDEFF0] px-2.5 py-0.5 text-[10.5px] font-bold text-[#0A7C80]">Optional</span>}
          </span>
          {s.id && (
            <span className="mt-auto flex justify-end border-t border-[#EEF2F6] pt-3">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOpenStop(s.id!)}
                className="rounded-full border-[1.5px] border-[#E3E8EE] px-4 py-2 text-[13.5px] font-semibold text-[#0D2436] hover:border-[#0A7C80]"
              >
                Details
              </button>
            </span>
          )}
        </div>
      </article>
    );
  };

  /** What TripJack said about a stay: its live price, or the hotels that have a room. */
  const stayLine = (p: ReturnType<typeof stayPrice>) => {
    if (!p) return checking ? <span className="text-[12.5px] text-[#566E85]">Checking live hotel rates…</span> : null;
    if ((p.status === "not_matched" || p.status === "unavailable") && p.alternatives?.length) {
      return (
        <span className="flex flex-col gap-1 rounded-xl bg-[#F3F6F9] p-2.5 text-[12.5px] text-[#3F5A72]">
          <strong className="text-[12px]">
            {p.status === "unavailable"
              ? `No room at ${p.hotel?.name ?? "this hotel"} for these dates · hotels with a room, live from TripJack`
              : "Not a hotel we can book · hotels with a room, live from TripJack"}
          </strong>
          {p.alternatives.map((a) => (
            <span key={a.hotel.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{a.hotel.name}{a.stars ? ` · ${a.stars}★` : ""}</span>
              <span className="flex-none font-bold tabular-nums text-[#0D2436]">{inr(a.total)}{p.nights ? ` · ${p.nights} ${p.nights === 1 ? "night" : "nights"}` : ""}</span>
            </span>
          ))}
          <span className="text-[11px]">Suggestions only: your trip keeps its stay, and they are not in your total.</span>
        </span>
      );
    }
    if (p.status === "priced") {
      const nights = p.nights || 1;
      return (
        <span className="flex flex-col gap-0.5">
          <span className="text-[13.5px] text-[#566E85]">
            {[`${nights} ${nights === 1 ? "night" : "nights"}`, p.room, p.meal_basis].filter(Boolean).join(" · ")}
          </span>
          <span className="text-[13px] text-[#566E85]">
            <strong className="text-[19px] tabular-nums text-[#0D2436]">{inr((p.total ?? 0) / nights)}</strong> per night ·{" "}
            {p.rooms?.length ? `${p.rooms.length === 1 ? `1 room (${p.rooms[0]})` : `${p.rooms.length} rooms`} · ` : ""}
            {nights} {nights === 1 ? "night" : "nights"} {inr(p.total ?? 0)}
          </span>
          <span className="text-[11.5px] text-[#0B7A57]">Live from TripJack{p.checked_at ? `, checked ${clock(p.checked_at)}` : ""}</span>
        </span>
      );
    }
    const why: Record<string, string> = {
      no_dates: "Add your dates to see the live price",
      unavailable: "No room at this hotel for these dates",
      no_rooms: "No room set-up fits your group here: every room needs an adult, and at most four children",
      error: "Live price not available right now",
    };
    return why[p.status] ? <span className="text-[12.5px] font-semibold text-[#B86E00]">{why[p.status]}</span> : null;
  };

  const card = (s: Stop, i: number, d: ItineraryDay) => {
    const key = `${s.name}-${i}`;
    if (s.kind === "travel" && (ARRIVING.test(s.name) || LEAVING.test(s.name))) return flightCard(s, key);
    if (s.kind === "travel") return roadCard(s, key);
    if (s.kind === "note") return noteRow(s, key);
    return placeCard(s, key, d.n);
  };

  return (
    <div className="min-h-dvh bg-[#FFFFFF] text-[#0D2436]">
      {header(mine ? `Your ${where} trip` : t.title, `${days.length} ${days.length === 1 ? "day" : "days"} · ${mine ? "made for you" : `by ${who}`}`)}

      <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 pb-32 pt-6 md:px-10 md:pt-7">
        {/* The trip: its picture, name, dates and who is going */}
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[#072338] text-white">
          {t.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- backend media
            <img src={t.cover_image_url} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 -z-20 bg-gradient-to-br from-[#072338] to-[#0A7C80]" />
          )}
          <span className="absolute inset-0 -z-10 bg-gradient-to-r from-[#041A2C]/85 via-[#041A2C]/45 to-[#041A2C]/5" />
          <div className="flex min-h-[230px] flex-col justify-between gap-5 p-6 md:p-9">
            <div className="flex flex-wrap items-start justify-between gap-3">
              {mine ? (
                <span className="inline-flex flex-wrap items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-semibold">
                  Trip no. <strong className="font-mono tracking-wider">{`${mine.code.slice(0, 4)}-${mine.code.slice(4)}`.toUpperCase()}</strong>
                </span>
              ) : (
                <span />
              )}
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={sharing}
                  onClick={() => setSharing((open) => !open)}
                  className="rounded-full bg-white px-4 py-2.5 text-sm font-bold text-[#072338] shadow-sm"
                >
                  + Invite
                </button>
                {sharing && (
                  <div
                    role="group"
                    aria-label="Invite"
                    className="absolute right-0 top-[calc(100%+8px)] z-20 flex w-[300px] flex-col gap-2.5 rounded-2xl border border-[#E3E8EE] bg-white p-4 text-[#0D2436] shadow-lg"
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
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-bold text-[#22DDE0]">
                {mine
                  ? `${name ? `${name}’s trip board` : "Your trip board"} · ${mine.build?.fromReel ? "Made for you · from your reel" : `Made for you · based on ${who}’s trip`}`
                  : `A trip by ${who}`}
              </span>
              <h1 className="font-display m-0 text-[36px] font-medium leading-[1.05] md:text-[54px]">{mine ? `Your ${where} trip` : t.title}</h1>
              <p className="m-0 text-[14.5px] text-white/90">
                {firstDate ? `${firstDate} → ${lastDate} · ` : ""}
                {days.length} {days.length === 1 ? "day" : "days"} · {stops} stops
                {mine
                  ? `${mine.originCity ? ` · from ${mine.originCity}` : ""} · ${partyText(mine.party) || "1 traveller"} · ${mine.pace} pace`
                  : ` · ${days.reduce((n, d) => n + d.stops.filter((s) => s.origin === "reel").length, 0)} from ${who}’s reel`}
              </p>
              {mine?.build?.status === "ready" && mine.build.persona && (
                <span className="text-[12.5px] text-white/70">
                  Planned for {PERSONA[mine.build.persona] ?? "your group"} · {mine.build.aiBuilt ? "planned with AI, checked against the places in the reel" : "arranged from the places in the reel"}
                </span>
              )}
              {mine && (
                <Link
                  href={detailsHref(mine)}
                  className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border-[1.5px] border-white/70 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-white/10"
                >
                  <Pencil className="size-3.5" aria-hidden="true" /> Change details
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-7 md:grid-cols-[1fr_340px]">
          <section className="flex min-w-0 flex-col gap-4">
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

            <span className="text-[13.5px] text-[#566E85]">Tap any card for photos, details and notes</span>
            <div role="tablist" aria-label="Days" className="flex gap-2.5 overflow-x-auto pb-1.5">
              {days.map((d: ItineraryDay, i) => {
                const on = i === current;
                const lead = d.stops.find((x) => x.image);
                const LeadIcon = KIND_ICON[d.stops.find((x) => x.kind !== "travel" && x.kind !== "note")?.kind ?? "sight"] ?? Landmark;
                return (
                  <button
                    key={d.n}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setDayIx(i)}
                    className={`flex flex-none cursor-pointer items-center gap-3 rounded-2xl bg-white p-2 pr-4 text-left text-[#0D2436] ${
                      on ? "border-2 border-[#C43B58] shadow-[0_6px_18px_rgba(196,59,88,.12)]" : "border border-[#E8EDF2] hover:border-[#C9D3DE]"
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
                      <span className="text-xs text-[#5F6B78]">{dateOf(i) || `${d.stops.length} ${d.stops.length === 1 ? "stop" : "stops"}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {day && (
              <div role="tabpanel" aria-label={`Day ${day.n}`} className="flex flex-col gap-3">
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-[12px] font-bold tracking-[.1em] text-[#C43B58]">
                    DAY {day.n}{dateOf(current) ? ` · ${dateOf(current).toUpperCase()}` : ""}
                  </span>
                  <span className="text-[13px] text-[#5F6B78]">
                    {day.stops.length} {day.stops.length === 1 ? "plan" : "plans"}
                  </span>
                </div>
                <h2 className="m-0 -mt-1 mb-1 flex items-center gap-2.5 font-sans text-[26px] font-bold leading-tight tracking-tight md:text-[30px]">
                  {(() => {
                    // The day is named for what it is for: its sights and experiences, not the ride or the lunch.
                    const main = day.stops.filter((x) => ["sight", "experience", "area"].includes(x.kind));
                    if (main.length) return main.slice(0, 2).map((x) => x.name).join(" and ");
                    // A day of getting there or going home: say so, not the rides.
                    const stay = day.stops.find((x) => x.kind === "stay");
                    if (stay) return `Arrive in ${stay.name.replace(/^Stay in /, "")}`;
                    if (current === days.length - 1) return "Heading home";
                    return day.stops[0]?.name ?? "";
                  })()}
                  <button
                    type="button"
                    disabled={opening}
                    onClick={() => chatWithArya(`Change day ${day.n}.`)}
                    aria-label={`Ask Arya to change day ${day.n}`}
                    className="grid size-9 flex-none place-items-center rounded-full text-[#7A4E9A] hover:bg-[#F2EEFB] disabled:opacity-60"
                  >
                    <Sparkles className="size-5" aria-hidden="true" />
                  </button>
                </h2>
                {(() => {
                  // Where they sleep tonight: the latest stay reached by this day.
                  const stay = days.slice(0, current + 1).flatMap((d) => d.stops).filter((x) => x.kind === "stay").at(-1);
                  if (!stay) return null;
                  return (
                    <span className="-mt-1 inline-flex w-fit items-center gap-2 rounded-full bg-[#F1EAF8] px-3 py-1 text-[12.5px] font-semibold text-[#6A3FA0]">
                      <BedDouble className="size-4" /> {current === days.length - 1 ? `Check out of ${stay.name.replace(/^Stay in /, "")}` : `Tonight: ${stay.name}`}
                    </span>
                  );
                })()}
                {day.stops.map((s, i) => (
                  <div key={`${s.name}-${i}`} className="flex flex-col gap-3">
                    {card(s, i, day)}
                    {s.transfer && (
                      <span className="ml-6 flex items-center gap-2.5 border-l-2 border-dashed border-[#D5DDE6] py-1 pl-4 text-[13px] font-semibold text-[#3F5A72]">
                        <Car className="size-4 text-[#566E85]" aria-hidden="true" /> {s.transfer}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {mine?.build?.status === "ready" && mine.build.tips.length > 0 && (
              <div className="mt-2 flex flex-col gap-2.5 rounded-[22px] border border-[#E3E8EE] bg-[#F9FBFC] p-5">
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
            <div className="flex flex-col gap-3 rounded-[22px] border border-[#E3E8EE] bg-white p-5">
              <span className="text-[12px] font-semibold text-[#3F5A72]">{mine ? "Live price for your trip" : "Live prices"}</span>
              {real ? (
                <>
                  <span className="flex items-baseline justify-between gap-2">
                    <strong className="text-[34px] leading-none tabular-nums">{real.total}</strong>
                    <span className="text-right text-[13px] text-[#566E85]">{`${real.complete ? "Total" : "Total so far"} for ${travellers}`}</span>
                  </span>
                  <button
                    type="button"
                    aria-expanded={included}
                    onClick={() => setIncluded((o) => !o)}
                    className="w-fit text-[14px] font-bold text-[#0A7C80]"
                  >
                    {included ? "Hide what’s included" : "See what’s included"}
                  </button>
                  {included && (
                    <span className="flex flex-col gap-1.5 rounded-xl bg-[#F7F9FB] p-3">
                      {real.rows.map(([label, price]) => (
                        <span key={label} className="flex justify-between gap-3 text-[13px] text-[#3F5A72]">
                          <span>{label}</span>
                          <span className="text-right font-semibold tabular-nums text-[#0D2436]">{price}</span>
                        </span>
                      ))}
                      <span className="pt-1 text-[11.5px] text-[#5F6B78]">
                        Live from TripJack{real.checkedAt ? `, checked ${clock(real.checkedAt)}` : ""}, taxes included. Experiences, meals and transfers are priced at checkout.
                      </span>
                    </span>
                  )}
                </>
              ) : (
                <span role="status" className="text-[14px] leading-normal text-[#3F5A72]">
                  {!mine
                    ? "Add your dates, the city you fly from and who’s going: we price the flights and hotels live from TripJack."
                    : checking
                      ? "Asking TripJack for live flight and hotel prices for your dates…"
                      : "TripJack has no live price for these dates yet. Try other dates in Change details."}
                </span>
              )}
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
              {mine && (
                <Link href={detailsHref(mine)} className="border-t border-[#EEF2F6] pt-3 text-center text-[14px] font-bold text-[#0A7C80] no-underline">
                  Change dates, travellers or preferences
                </Link>
              )}
              {!real && <span className="text-center text-[11px] text-[#5F6B78]">We show only TripJack’s live prices: nothing is estimated.</span>}
            </div>
          </aside>
        </div>
      </main>

      {/* Arya, always within reach */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <button
          type="button"
          disabled={opening}
          onClick={() => chatWithArya()}
          className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-full border border-[#E3E8EE] bg-white py-2.5 pl-2.5 pr-5 text-left shadow-[0_14px_40px_rgba(7,35,56,.18)] disabled:opacity-80"
        >
          <span
            aria-hidden="true"
            className="font-display grid size-[38px] flex-none place-items-center rounded-full text-[20px] font-semibold italic text-white"
            style={{ background: "linear-gradient(135deg,#22DDE0 0%,#1A6094 100%)" }}
          >
            A
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <strong className="text-[15px]">{opening ? "Opening Arya…" : "Ask Arya to change anything"}</strong>
            <span className="truncate text-[12.5px] text-[#566E85]">“Make day {easier} easier”</span>
          </span>
          <Sparkles className="size-5 flex-none text-[#7A4E9A]" aria-hidden="true" />
        </button>
      </div>

      {openStop && <StopDetailsDialog code={code} itemId={openStop} onClose={() => setOpenStop(null)} />}
      {flights && <FlightDialog where={where} nights={Math.max(1, days.length - 1)} signedIn={!!me.data} onClose={() => setFlights(false)} />}
    </div>
  );
}
