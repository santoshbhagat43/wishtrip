"use client";

import Link from "next/link";

import { LINKS } from "../data";
import { B4Header } from "../header";
import { CARD, Kicker } from "../flow";
import { Path } from "../icons";

const PLAY = "M4 4h16v16H4zM10 9l5 3-5 3z";
const BOARD = "M4 5h16v14H4zM4 10h16M10 10v9";
const COIN = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 12h6M12 9v6";

const STEPS = [
  { icon: PLAY, title: "Connect your Instagram or YouTube", body: "Pick the trips you've posted. No new content needed." },
  { icon: BOARD, title: "We turn them into bookable trips", body: "Your reels become a day-by-day trip with real prices, credited to you." },
  { icon: COIN, title: "Earn every time someone books", body: "You get your share of every booking from your trip, paid monthly to your bank." },
];

const PERKS = [
  { title: "A share of every booking", body: "Paid monthly to your bank, for as long as people book." },
  { title: "Your name on every trip", body: "Travellers see who made it. You build a following." },
  { title: "A dashboard that shows it all", body: "Views, saves and bookings for each trip." },
  { title: "We do the hard part", body: "Flights, stays, support and refunds are on us." },
];

const FAQ = [
  ["What does it cost?", "Nothing. You earn; travellers pay the same price."],
  ["Do I need to make new content?", "No. We start from reels you've already posted."],
  ["When do I get paid?", "On the 5th of every month, for the bookings in the month before."],
];

const DASH = [
  ["Views on wishtrip", "4,210"],
  ["Bookings this month", "18"],
  ["Your share of each booking", "Set with you"],
  ["Earned this month", "Paid on the 5th"],
];

/** The creator program landing: how earning works, what you get, and a way in. */
export function CreatorsScreen() {
  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <B4Header />

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
              <Link href={LINKS.signIn} className="rounded-full bg-[#22DDE0] px-7 py-4 text-base font-bold text-[#072338] no-underline">
                Join the creator program
              </Link>
              <span className="text-[13.5px] text-[#A9C2D4]">Free to join · for Instagram and YouTube creators</span>
            </div>
          </div>

          {/* Dashboard preview */}
          <div className="rounded-[22px] bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur">
            <Kicker className="text-[#6BEDEF]!">EXAMPLE · YOUR CREATOR DASHBOARD</Kicker>
            <div className="mt-3 flex items-center gap-3">
              <span className="size-11 flex-none rounded-xl bg-[#0E3550]" />
              <span className="flex flex-col">
                <strong className="text-[15px]">Slow North Goa</strong>
                <span className="text-[12.5px] text-[#A9C2D4]">Your reel from Dec 2025</span>
              </span>
            </div>
            <div className="mt-3 flex flex-col">
              {DASH.map(([k, v], i) => (
                <span key={k} className={`flex items-center justify-between py-2.5 text-[13.5px] ${i < DASH.length - 1 ? "border-b border-white/10" : ""}`}>
                  <span className="text-[#A9C2D4]">{k}</span>
                  <span className="font-semibold text-white">{v}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-[#8DA7BC]">Paid to your bank on the 5th of every month.</p>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="px-4 py-14 md:px-10 md:py-20">
        <div className="mx-auto max-w-[1240px]">
          <Kicker teal>WHAT YOU GET</Kicker>
          <h2 className="font-display mb-0 mt-2 max-w-[620px] text-[30px] font-medium leading-[1.12] md:text-[42px]">
            Your reels keep working long after you&rsquo;re home
          </h2>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {PERKS.map((p) => (
              <div key={p.title} className={`${CARD} flex flex-col gap-1.5 p-5`}>
                <strong className="text-[16px]">{p.title}</strong>
                <span className="text-[14px] leading-normal text-[#566E85]">{p.body}</span>
              </div>
            ))}
          </div>

          <div className="mt-12 grid items-start gap-10 md:grid-cols-[1fr_380px]">
            <div>
              <Kicker>QUESTIONS</Kicker>
              <dl className="mt-3 flex flex-col">
                {FAQ.map(([q, a]) => (
                  <div key={q} className="border-b border-[#EDE6DC] py-4">
                    <dt className="text-[16px] font-semibold">{q}</dt>
                    <dd className="m-0 mt-1 text-[14.5px] text-[#566E85]">{a}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Join card — leads to the real creator sign-in */}
            <div className={`${CARD} flex flex-col gap-3 rounded-[22px] p-6`}>
              <h3 className="font-display m-0 text-[24px] font-medium">Ready to earn from your trips?</h3>
              <p className="m-0 text-[14.5px] leading-normal text-[#566E85]">
                Sign in with your email to start. We&rsquo;ll set you up and turn your first reel into a bookable trip.
              </p>
              <Link href={LINKS.signIn} className="rounded-full bg-[#072338] p-[15px] text-center text-base font-bold text-white no-underline">
                Join the creator program
              </Link>
              <span className="text-center text-xs text-[#8A7F72]">Free to join. You keep the rights to your content.</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
