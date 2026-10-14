"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LINKS, REELS } from "../data";
import { B4Header } from "../header";
import { Kicker } from "../flow";

const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

/** Home, carousel variant: a live, auto-advancing wall of creator reels behind the pitch. */
export function HomeCarouselScreen() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % REELS.length), 2600);
    return () => clearInterval(t);
  }, []);
  // Three visible, sliding.
  const shown = [0, 1, 2].map((k) => REELS[(i + k) % REELS.length]);

  return (
    <div className="min-h-dvh bg-[#071B2C]">
      <B4Header />
      <main className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-10 px-4 pb-16 pt-[96px] text-white md:grid-cols-[1fr_440px] md:px-10 md:pt-[130px]">
        <div className="flex flex-col gap-5">
          <Kicker className="text-[#6BEDEF]!">REELS, MADE BOOKABLE</Kicker>
          <h1 className="font-display m-0 text-[44px] font-medium leading-[1.05] md:text-[64px]">
            The trips people save are the trips people take
          </h1>
          <p className="m-0 max-w-[520px] text-[16px] leading-[1.6] text-[#A9C2D4] md:text-[18px]">
            Paste a reel you love. We watch it, pull out every place, and turn it into a day-by-day trip you can actually book.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={LINKS.reel} className="rounded-full bg-[#22DDE0] px-7 py-4 text-base font-bold text-[#072338] no-underline">Turn a reel into a trip →</Link>
            <Link href={LINKS.start} className="rounded-full border border-white/25 px-7 py-4 text-base font-semibold text-white no-underline">Start from scratch</Link>
          </div>
        </div>

        <div className="flex justify-center gap-3">
          {shown.map((r, k) => (
            <Link
              key={r.title}
              href={LINKS.reel}
              className={`relative block aspect-[9/16] overflow-hidden rounded-[20px] no-underline transition-all duration-500 ${k === 1 ? "w-[160px] opacity-100 md:w-[180px]" : "hidden w-[140px] opacity-60 md:block md:w-[150px]"}`}
            >
              <Image src={r.img} alt={r.alt} fill sizes="180px" className="object-cover" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3 text-white">
                <strong className="text-[13.5px] leading-tight">{r.title}</strong>
                <span className="text-[11.5px] text-[#C9DAE6]">{r.handle} · {fmt(r.booked)} booked</span>
              </span>
            </Link>
          ))}
        </div>
      </main>
      <div className="flex justify-center gap-1.5 pb-10">
        {REELS.map((_, k) => (
          <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-5 bg-[#22DDE0]" : "w-1.5 bg-white/25"}`} />
        ))}
      </div>
    </div>
  );
}
