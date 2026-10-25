"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  IMG,
  LINKS,
  START_IDEAS,
  STORY_CARDS,
  STORY_COPY,
  STORY_DESKTOP,
  STORY_ICONS,
  STORY_MOBILE,
  type StoryLayout,
} from "./data";
import { B4Header } from "./header";
import { ARROW, CLOSE, Path, Play } from "./icons";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Variant = "mobile" | "desktop";

/** Type and spacing that differ between the two designed stages. */
const V = {
  mobile: { header: 60, textTop: 70, eyebrow: 11, h1: 34, h1Line: 1.2, h1Max: 360, h1Min: 82, sub: 14.5, subMax: 350, subMin: 65, gap: 8 },
  desktop: { header: 76, textTop: 92, eyebrow: 12.5, h1: 58, h1Line: 1.12, h1Max: 1140, h1Min: 65, sub: 17, subMax: 640, subMin: 51, gap: 12 },
};

function StartPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"describe" | "reel">("describe");
  const [reelUrl, setReelUrl] = useState("");
  const router = useRouter();
  return (
    <div
      role="dialog"
      aria-label="Start planning"
      className="relative z-[45] mt-1 flex w-[560px] max-w-full flex-col gap-3 rounded-3xl border border-[#E3E8EE] bg-white p-[18px] text-left shadow-[0_30px_70px_rgba(7,35,56,.22)]"
    >
      <div className="flex items-center justify-between">
        <strong className="text-[17px]">How do you want to start?</strong>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 cursor-pointer place-items-center rounded-full bg-[#F3F6F9]">
          <Path d={CLOSE} size={20} stroke="#0D2436" />
        </button>
      </div>
      <div role="radiogroup" aria-label="Start with" className="grid grid-cols-2 gap-1.5 rounded-[14px] bg-[#F3F6F9] p-1">
        {(
          [
            ["describe", "Describe it", "M4 6h16M4 12h10M4 18h7"],
            ["reel", "Paste a reel", "M4 4h16v16H4zM10 9l5 3-5 3z"],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={`inline-flex cursor-pointer items-center justify-center gap-[7px] rounded-[11px] px-2 py-2.5 text-sm font-semibold ${
              mode === id ? "bg-white text-[#072338] shadow-[0_2px_8px_rgba(7,35,56,.12)]" : "bg-transparent text-[#566E85]"
            }`}
          >
            <Path d={icon} size={17} />
            {label}
          </button>
        ))}
      </div>
      {mode === "describe" ? (
        <>
          <label htmlFor="b4-desc" className="text-[12.5px] text-[#566E85]">
            Tell Arya in your own words: where, when, who’s going
          </label>
          <textarea
            id="b4-desc"
            rows={3}
            placeholder="e.g. Goa in December with my parents. Mum can’t walk much. Under ₹50k."
            className="resize-none rounded-[14px] border-[1.5px] border-[#E3DCD2] px-3.5 py-3 text-base leading-[1.45] text-[#0D2436] outline-none focus:border-[#0A7C80]"
          />
          <div className="rail flex gap-1.5 overflow-x-auto">
            {START_IDEAS.map((idea) => (
              <Link
                key={idea}
                href={LINKS.arya}
                className="flex-none whitespace-nowrap rounded-full border border-[#BDEFF0] bg-white px-[11px] py-[7px] text-[12.5px] font-semibold text-[#0A7C80] no-underline"
              >
                {idea}
              </Link>
            ))}
          </div>
          <Link href={LINKS.arya} className="rounded-full bg-[#072338] p-3.5 text-center text-base font-semibold text-white no-underline">
            Plan it with Arya →
          </Link>
        </>
      ) : (
        <>
          <label htmlFor="b4-reel" className="text-[12.5px] text-[#566E85]">
            Paste a reel you saved. We’ll watch it and pull out every place.
          </label>
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(reelUrl.trim() ? `${LINKS.reel}?url=${encodeURIComponent(reelUrl.trim())}` : LINKS.reel);
            }}
          >
            <input
              id="b4-reel"
              value={reelUrl}
              onChange={(e) => setReelUrl(e.target.value)}
              inputMode="url"
              placeholder="instagram.com/reel/…"
              className="rounded-[14px] border-[1.5px] border-[#E3DCD2] px-3.5 py-[13px] text-base text-[#0D2436] outline-none focus:border-[#0A7C80]"
            />
            <span className="text-xs text-[#5F6B78]">Works with public Instagram reels.</span>
            <button type="submit" className="cursor-pointer rounded-full border-0 bg-[#072338] p-3.5 text-center text-base font-semibold text-white">
              Get the trip from this reel →
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/** One designed stage (390×844 phone or 1200×900 desktop), driven by scroll progress p. */
function Stage({ layout, variant, p }: { layout: StoryLayout; variant: Variant; p: number }) {
  const v = V[variant];
  const [startOpen, setStartOpen] = useState(false);
  const phase = p < 0.15 ? 0 : p < 0.82 ? 1 : 2;
  const [eyebrow, h1a, pill, h1b, subline] = STORY_COPY[phase];
  const phaseColor = phase === 0 ? "#C43B58" : "#0A7C80";
  const bp = ease(clamp((p - 0.08) / 0.4));
  const board = layout.board;
  const mobile = variant === "mobile";

  return (
    <>
      <div
        className="absolute z-20 flex flex-col items-center text-center"
        style={{ left: mobile ? 16 : 0, right: mobile ? 16 : 0, top: v.textTop, gap: v.gap }}
      >
        <span className="font-bold tracking-[.16em]" style={{ fontSize: v.eyebrow, color: phaseColor }}>
          {eyebrow}
        </span>
        <h1
          className="font-display m-0 font-medium tracking-[-0.02em]"
          style={{ fontSize: v.h1, lineHeight: v.h1Line, maxWidth: v.h1Max, minHeight: v.h1Min }}
        >
          <span className="relative z-[1]">{h1a}</span>{" "}
          <span
            className="whitespace-nowrap rounded-full italic"
            style={{
              color: phase === 0 ? "#C43B58" : "#0A7C80",
              background: phase === 0 ? "#FCE9ED" : "#DCF8F9",
              padding: "0 .12em 0 .16em",
              margin: "0 -.14em 0 -.04em",
            }}
          >
            {pill}
          </span>{" "}
          {h1b}
        </h1>
        <p className="m-0 leading-normal text-[#3F5A72]" style={{ fontSize: v.sub, maxWidth: v.subMax, minHeight: v.subMin }}>
          {subline}
        </p>
        <button
          type="button"
          onClick={() => setStartOpen(!startOpen)}
          aria-expanded={startOpen}
          className={`inline-flex cursor-pointer items-center gap-2.5 rounded-full border-0 bg-[#072338] font-semibold text-white shadow-[0_0_0_5px_rgba(34,221,224,.25),0_14px_30px_rgba(7,35,56,.28)] ${
            mobile ? "mt-1 px-[26px] py-3.5 text-base" : "mt-1.5 px-[34px] py-4 text-[17px]"
          }`}
        >
          Start planning
          <Path d={ARROW} size={18} stroke="#22DDE0" width={2.4} />
        </button>
        {startOpen && <StartPanel onClose={() => setStartOpen(false)} />}
      </div>

      {/* The board fades in under the cards. */}
      <div
        className="absolute rounded-[22px] border border-[#DFE7EE] bg-white shadow-[0_30px_70px_rgba(13,36,54,.14)]"
        style={{
          left: board.x,
          top: board.y,
          width: board.w,
          height: board.h,
          opacity: bp,
          transform: `scale(${0.94 + 0.06 * bp})`,
          transformOrigin: "50% 0",
        }}
      >
        <div className={`flex items-center border-b border-[#E8EEF4] ${mobile ? "gap-2 px-3.5 py-3" : "gap-3.5 px-[22px] py-4"}`}>
          <Image src={IMG.mark} alt="" width={30} height={30} className={mobile ? "size-6 flex-none" : "size-[30px] flex-none"} />
          <strong className={`flex-1 truncate ${mobile ? "text-[13px]" : "text-[15px]"}`}>Slow North Goa, made yours</strong>
          <span className={`whitespace-nowrap text-[#566E85] ${mobile ? "text-[11px]" : "text-[13px]"}`}>12–16 Dec · 3 travellers</span>
        </div>
        <div
          className={`absolute flex items-center gap-2.5 rounded-[14px] bg-[#072338] text-white ${mobile ? "inset-x-3 bottom-3 px-3 py-2.5" : "inset-x-[22px] bottom-[18px] px-4 py-3"}`}
          style={{ opacity: clamp((p - 0.78) / 0.15) }}
        >
          <span className="flex flex-1 flex-col">
            <strong className={mobile ? "text-[17px]" : "text-[19px]"}>₹46,200</strong>
            <span className="text-[12.5px] text-[#A9C2D4]">for 3, all-in · one checkout</span>
          </span>
          <Link
            href={LINKS.checkout}
            className={`rounded-full bg-[#22DDE0] font-bold text-[#072338] no-underline ${mobile ? "px-3.5 py-2.5 text-[13px]" : "px-5 py-3 text-[14.5px]"}`}
          >
            Book in one go
          </Link>
        </div>
      </div>

      {STORY_CARDS.map((c, i) => {
        const t = ease(clamp((p - 0.12 - i * 0.07) / 0.45));
        const s = layout.s[c.id];
        const b = layout.b[c.id];
        const done = t > 0.85;
        const reel = c.id === "reel";
        return (
          <div
            key={c.id}
            className="absolute"
            style={{
              left: lerp(s[0], b[0], t),
              top: lerp(s[1], b[1], t),
              width: lerp(s[3], b[3], t),
              transform: `rotate(${lerp(s[2], b[2], t)}deg)`,
              zIndex: 10 + i,
            }}
          >
            <div
              className="relative flex gap-2.5 rounded-2xl border bg-white p-2"
              style={{
                flexDirection: reel ? "column" : "row",
                alignItems: reel ? "stretch" : "center",
                borderColor: done ? "#BDEFF0" : "#DFE7EE",
                boxShadow: done ? "0 2px 8px rgba(13,36,54,.06)" : "0 18px 40px rgba(13,36,54,.16)",
              }}
            >
              {reel && (
                <span className="relative block w-full overflow-hidden rounded-[11px]" style={{ height: Math.round(lerp(layout.imgHs, layout.imgH, t)) }}>
                  <Image src={c.img!} alt="Saved reel from a Goa beach" fill sizes="200px" className="object-cover" />
                  <span className="absolute left-1/2 top-1/2 grid size-[34px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90">
                    <Play />
                  </span>
                </span>
              )}
              {!reel && c.img && <Image src={c.img} alt="" width={40} height={40} className="size-10 flex-none rounded-[10px] object-cover" />}
              {!reel && c.icon && (
                <span className="grid size-10 flex-none place-items-center rounded-[10px]" style={{ background: c.iconBg }}>
                  <Path d={STORY_ICONS[c.icon]} stroke="#0D2436" width={1.8} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-0.5">
                <strong className="truncate text-sm leading-tight">{done ? c.bt : c.title}</strong>
                <span className="truncate text-[12.5px] text-[#566E85]">{done ? c.bs : c.sub}</span>
              </span>
              <span
                className="absolute -top-[9px] right-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ background: c.sc, opacity: 1 - t }}
              >
                {c.src}
              </span>
              <span
                className="absolute -top-2.5 right-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#22DDE0] py-0.5 pl-1.5 pr-2 text-[11px] font-bold text-[#072338] shadow-[0_4px_10px_rgba(18,201,206,.35)]"
                style={{ opacity: done ? 1 : 0 }}
              >
                <Path d="M12 3v4M12 17v4M3 12h4M17 12h4" size={10} stroke="#072338" width={2.6} />
                {c.why}
              </span>
            </div>
          </div>
        );
      })}

      <span
        className="pointer-events-none absolute inset-x-0 z-[25] flex justify-center"
        style={{ bottom: mobile ? 18 : 22, opacity: 1 - Math.min(1, p * 4) }}
      >
        <span
          className={`inline-flex items-center gap-2 rounded-full border-[1.5px] border-[#F6C9D3] bg-white font-bold text-[#C43B58] shadow-[0_8px_24px_rgba(196,59,88,.18)] ${
            mobile ? "px-4 py-2 text-[14.5px]" : "px-5 py-2.5 text-base"
          }`}
        >
          Scroll to bring it together
          <span className="cue-arrow inline-block" aria-hidden="true">
            ↓
          </span>
        </span>
      </span>
    </>
  );
}

/**
 * The opening scroll story: six scattered apps assemble into one trip board as you scroll.
 * Both designed stages render; CSS shows the right one, so there's no layout flash on load.
 */
function StoryVariant({ variant }: { variant: Variant }) {
  const layout = variant === "mobile" ? STORY_MOBILE : STORY_DESKTOP;
  const section = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = section.current;
      if (!el || el.offsetParent === null) return; // the other variant is showing
      setP(clamp(-el.getBoundingClientRect().top / layout.travel));
      const { w, h } = layout.stage;
      const fitW = variant === "mobile" ? window.innerWidth / w : Math.min(1, (window.innerWidth - 40) / w);
      setScale(Math.min(variant === "mobile" ? fitW : 1, fitW, window.innerHeight / h));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [layout, variant]);

  const { w, h } = layout.stage;
  const v = V[variant];
  // Keep the headline below the (unscaled) header when the stage shrinks to fit.
  const offsetY = Math.max(0, v.header + 6 - v.textTop * scale);

  return (
    <div ref={section} className={`relative ${variant === "mobile" ? "h-[2244px] md:hidden" : "hidden h-[2400px] md:block"}`}>
      <div className="sticky top-0 h-[100svh] overflow-hidden" style={{ background: "radial-gradient(120% 70% at 50% 0%, #FDEBDD 0%, #FFFFFF 55%)" }}>
        <B4Header />
        <div
          className="absolute left-1/2 top-0"
          style={{ width: w, height: h, marginLeft: -w / 2, transform: `translateY(${offsetY}px) scale(${scale})`, transformOrigin: "50% 0" }}
        >
          <Stage layout={layout} variant={variant} p={p} />
        </div>
      </div>
    </div>
  );
}

export function ScrollStory() {
  return (
    <>
      <StoryVariant variant="mobile" />
      <StoryVariant variant="desktop" />
    </>
  );
}
