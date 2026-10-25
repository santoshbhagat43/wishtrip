"use client";

import Image from "next/image";
import Link from "next/link";
import type { CountryCode } from "libphonenumber-js";
import { useState } from "react";

import { api, errorMessage, unwrap } from "@/lib/api/client";

import { B4Header } from "../header";
import { CARD, Kicker } from "../flow";
import { Path } from "../icons";
import { PhoneField, countryName, toE164 } from "../phone-field";

const PLAY = "M4 4h16v16H4zM10 9l5 3-5 3z";
const BOARD = "M4 5h16v14H4zM4 10h16M10 10v9";
const COIN = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 12h6M12 9v6";

const STEPS = [
  { icon: PLAY, title: "Connect your Instagram or YouTube", body: "Pick the trips you've posted. No new content needed." },
  { icon: BOARD, title: "We turn them into bookable trips", body: "Your reels become a day-by-day trip with real prices, credited to you." },
  { icon: COIN, title: "Earn every time someone books", body: "You get [X%] of every booking from your trip, paid monthly to your bank." },
];

const PERKS = [
  { title: "Earn [X%] of every booking", body: "Paid monthly to your bank, for as long as people book." },
  { title: "Your name on every trip", body: "Travellers see who made it. You build a following." },
  { title: "A dashboard that shows it all", body: "Views, saves and bookings for each trip." },
  { title: "We do the hard part", body: "Flights, stays, support and refunds are on us." },
];

const FAQ = [
  ["What does it cost?", "Nothing. You earn; travellers pay the same price."],
  ["Do I need to make new content?", "No. We start from reels you've already posted."],
  ["When do I get paid?", "On the 5th of every month, for the bookings in the month before."],
];

const DASH: [label: string, value: string, accent?: boolean][] = [
  ["Views on wishtrip", "18.2k"],
  ["Bookings this month", "42"],
  ["Your share of each booking", "[X%]"],
  ["Earned this month", "₹ [your earnings]", true],
];

/** The creator program landing: how earning works, what you get, and a way in. */
export function CreatorsScreen({ signInHref }: { signInHref: string }) {
  return (
    <div className="min-h-dvh bg-[#FFFFFF]">
      <B4Header solid />

      {/* Hero (dark) */}
      <section className="bg-[#072338] px-4 pb-14 pt-[84px] text-white md:px-10 md:pb-20 md:pt-[120px]">
        <div className="mx-auto grid max-w-[1240px] items-start gap-10 md:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-5">
            <Kicker className="text-[#6BEDEF]!">FOR CREATORS · EARN WITH WISHTRIP</Kicker>
            <h1 className="font-display m-0 text-[40px] font-medium leading-[1.06] md:text-[58px]">
              Your trip becomes a source of earning
            </h1>
            <p className="m-0 max-w-[560px] text-[16px] leading-[1.6] text-[#C9DAE6] md:text-[18px]">
              Already posted your travels? Every time someone books your trip on wishtrip, you earn. Your reels keep working long after you&rsquo;re home.
            </p>
            <div className="mt-1 flex flex-col gap-3.5">
              {STEPS.map((s) => (
                <div key={s.title} className="flex items-start gap-3.5">
                  <span className="grid size-11 flex-none place-items-center rounded-xl bg-[#0E3550]">
                    <Path d={s.icon} size={20} stroke="#6BEDEF" width={1.8} />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <strong className="text-[16px]">{s.title}</strong>
                    <span className="text-[14px] text-[#A9C2D4]">{s.body}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Link href="#apply" className="rounded-full bg-[#22DDE0] px-7 py-4 text-base font-bold text-[#072338] no-underline">
                Join the creator program
              </Link>
              <span className="text-[13.5px] text-[#A9C2D4]">Free to join · for Instagram and YouTube creators</span>
            </div>
          </div>

          {/* Example creator dashboard — a white card on the dark hero */}
          <div className="rounded-[22px] bg-white p-5 text-[#0D2436] shadow-[0_30px_70px_rgba(7,35,56,.3)] md:p-6">
            <Kicker teal>EXAMPLE · YOUR CREATOR DASHBOARD</Kicker>
            <div className="mt-3 flex items-center gap-3">
              <Image src="/b4/goa-hero-beach-9x16.webp" alt="" width={48} height={48} className="size-12 flex-none rounded-xl object-cover" />
              <span className="flex flex-col">
                <strong className="text-[15px]">Slow North Goa</strong>
                <span className="text-[12.5px] text-[#566E85]">Your reel from Dec 2025 · now a bookable trip</span>
              </span>
            </div>
            <div className="mt-3 flex flex-col">
              {DASH.map(([k, v, accent], i) => (
                <span key={k} className={`flex items-center justify-between py-3 text-[13.5px] ${i < DASH.length - 1 ? "border-b border-[#E8EDF2]" : ""}`}>
                  <span className="text-[#566E85]">{k}</span>
                  <strong className={accent ? "text-[#0B7A57]" : "text-[#0D2436]"}>{v}</strong>
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-[#5F6B78]">Paid to your bank on the 5th of every month.</p>
          </div>
        </div>
      </section>

      {/* What you get — the prototype's two-column layout: text + perks + FAQ on the
          left, a sticky apply card on the right. */}
      <section className="px-4 py-12 md:px-10 md:pb-20 md:pt-16">
        <div className="mx-auto grid max-w-[1240px] items-start gap-10 md:grid-cols-[1fr_440px] md:gap-12">
          <div className="flex flex-col gap-[18px]">
            <Kicker teal>WHAT YOU GET</Kicker>
            <h2 className="font-display m-0 max-w-[620px] text-[30px] font-medium leading-[1.12] md:text-[42px]">
              Your reels keep working long after you&rsquo;re home
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {PERKS.map((p) => (
                <div key={p.title} className={`${CARD} flex flex-col gap-1.5 p-5`}>
                  <strong className="text-[16px]">{p.title}</strong>
                  <span className="text-[14px] leading-normal text-[#566E85]">{p.body}</span>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <Kicker>QUESTIONS</Kicker>
              <dl className="mt-3 flex flex-col">
                {FAQ.map(([q, a]) => (
                  <div key={q} className="border-b border-[#E8EDF2] py-4">
                    <dt className="text-[16px] font-semibold">{q}</dt>
                    <dd className="m-0 mt-1 text-[14.5px] text-[#566E85]">{a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <aside id="apply" className="scroll-mt-24 md:sticky md:top-[100px]"><ApplyForm signInHref={signInHref} /></aside>
        </div>
      </section>
    </div>
  );
}

const INPUT =
  "rounded-[11px] border-[1.5px] border-[#E3E8EE] bg-white p-3 text-[15px] text-[#0D2436] outline-none focus:border-[#0A7C80]";
const FLABEL = "flex flex-col gap-1.5 text-[11px] font-bold tracking-[.12em] text-[#5F6B78]";
const FOLLOWERS = ["Under 10k", "10k to 50k", "50k to 200k", "200k+"];

/** A channel input: the platform's mark, then the field. Looks like one of the form's inputs. */
const CHANNEL_ROW =
  "flex items-center gap-2.5 rounded-[11px] border-[1.5px] border-[#E3E8EE] bg-white px-3 focus-within:border-[#0A7C80]";
const CHANNEL_INPUT = "min-w-0 flex-1 bg-transparent py-3 text-[15px] text-[#0D2436] outline-none";

function InstagramMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 flex-none">
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEDA75" />
          <stop offset=".35" stopColor="#FA7E1E" />
          <stop offset=".6" stopColor="#D62976" />
          <stop offset="1" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6.5" fill="url(#ig-grad)" />
      <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="4" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="16.1" cy="7.9" r="1" fill="#fff" />
    </svg>
  );
}

function YouTubeMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 flex-none">
      <rect y="4.5" width="24" height="15" rx="4.5" fill="#FF0000" />
      <path d="M9.9 8.9v6.2l5.4-3.1z" fill="#fff" />
    </svg>
  );
}
const POSTED = ["India", "Asia", "Europe", "Worldwide"];

/** The prototype's "Apply to join" form — creates a pending creator for staff to review. */
function ApplyForm({ signInHref }: { signInHref: string }) {
  const [form, setForm] = useState({
    email: "",
    name: "",
    handle: "", // Instagram
    youtube: "",
    followers: FOLLOWERS[1],
    posted_from: "",
  });
  const [waCountry, setWaCountry] = useState<CountryCode>("IN");
  const [waNumber, setWaNumber] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // A channel to look at is the one thing staff need to review an application.
    if (!form.handle.trim() && !form.youtube.trim()) {
      setError("Add your Instagram, your YouTube, or both, so we can see your work.");
      return;
    }
    // Optional, but if given it must be a real number for the chosen country.
    const whatsapp = waNumber.trim() ? toE164(waCountry, waNumber) : "";
    if (whatsapp === null) {
      setError(`That doesn't look like a valid WhatsApp number for ${countryName(waCountry)}.`);
      return;
    }
    setBusy(true);
    try {
      unwrap(await api.POST("/creators/apply", { body: { ...form, whatsapp } }));
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  // The confirmation sits in the same grid cell as the form, which stays laid out (just hidden),
  // so the card keeps its size instead of collapsing around a short message.
  return (
    <div className={`${CARD} grid rounded-[22px]`}>
    <form onSubmit={submit} aria-hidden={done} className={`flex flex-col gap-3 p-6 [grid-area:1/1] ${done ? "invisible" : ""}`}>
      <h3 className="font-display m-0 text-[24px] font-medium">Apply to join</h3>
      <p className="m-0 text-[13px] text-[#566E85]">Takes a minute. We reply on WhatsApp within 2 days.</p>
      <label className={FLABEL}>YOUR NAME<input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Meera Kamat" className={INPUT} /></label>
      <label className={FLABEL}>EMAIL<input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" className={INPUT} /></label>
      <div role="group" aria-labelledby="channels-label" className={FLABEL}>
        <span id="channels-label">YOUR CHANNELS</span>
        <span className="text-[12px] font-normal normal-case tracking-normal text-[#5F6B78]">
          Add Instagram, YouTube, or both.
        </span>
        <label className={CHANNEL_ROW}>
          <InstagramMark />
          <input
            aria-label="Instagram handle or link"
            value={form.handle}
            onChange={(e) => set("handle", e.target.value)}
            placeholder="@yourhandle"
            autoCapitalize="none"
            className={CHANNEL_INPUT}
          />
        </label>
        <label className={CHANNEL_ROW}>
          <YouTubeMark />
          <input
            aria-label="YouTube channel link or @handle"
            value={form.youtube}
            onChange={(e) => set("youtube", e.target.value)}
            placeholder="@yourchannel or channel link"
            autoCapitalize="none"
            className={CHANNEL_INPUT}
          />
        </label>
      </div>
      <div className={FLABEL}>
        WHATSAPP NUMBER
        <PhoneField
          country={waCountry}
          number={waNumber}
          onChange={(c, n) => {
            setWaCountry(c);
            setWaNumber(n);
          }}
          inputClassName={INPUT}
        />
      </div>
      <div className={FLABEL}>
        WHERE HAVE YOU POSTED TRIPS FROM?
        <span className="flex flex-wrap gap-1.5">
          {POSTED.map((o) => (
            <button key={o} type="button" onClick={() => set("posted_from", o)} className={`rounded-full border-[1.5px] px-3 py-1.5 text-[13px] font-semibold ${form.posted_from === o ? "border-[#072338] bg-[#072338] text-white" : "border-[#E3E8EE] bg-white text-[#3F5A72]"}`}>{o}</button>
          ))}
        </span>
      </div>
      <label className={FLABEL}>FOLLOWERS OR SUBSCRIBERS · YOUR BIGGEST CHANNEL<select value={form.followers} onChange={(e) => set("followers", e.target.value)} className={INPUT}>{FOLLOWERS.map((f) => <option key={f}>{f}</option>)}</select></label>
      {error && <p className="rounded-xl bg-[#FBE9E6] px-3 py-2 text-sm font-semibold text-[#B8362A]">{error}</p>}
      <button type="submit" disabled={busy} className="cursor-pointer rounded-full bg-[#072338] p-[15px] text-center text-base font-bold text-white disabled:opacity-60">
        {busy ? "Sending…" : "Apply to join"}
      </button>
      <p className="m-0 text-xs text-[#5F6B78]">Free to join. You keep the rights to your content.</p>
      <span className="text-center text-xs text-[#5F6B78]">
        Already applied? <a href={signInHref} className="font-semibold text-[#0A7C80]">Sign in</a>
      </span>
    </form>
    {done && (
      <div role="status" className="flex flex-col items-center justify-center gap-2 p-7 text-center [grid-area:1/1]">
        <span className="grid size-12 place-items-center rounded-full bg-[#E3F5EE]">
          <Path d="M5 12l5 5 9-10" size={22} stroke="#0B7A57" width={2.6} />
        </span>
        <h3 className="font-display m-0 text-[24px] font-medium">You&rsquo;re on the list</h3>
        <p className="m-0 max-w-[300px] text-[14px] text-[#566E85]">
          We&rsquo;ll message you on WhatsApp within 2 days to turn your first trip into a bookable one.
        </p>
      </div>
    )}
    </div>
  );
}
