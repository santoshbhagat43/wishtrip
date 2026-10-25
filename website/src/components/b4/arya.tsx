"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ARYA_ENDS, ARYA_OPTIONS, ARYA_SCRIPT, ARYA_STAGES, ARYA_STARTS, IMG, LINKS, type AryaStep } from "./data";
import { AryaMark, CHECK, Path } from "./icons";

const ARYA_BUBBLE = "rounded-[18px_18px_18px_4px] border border-white/[.14] bg-white/[.08] px-3.5 py-2.5 leading-[1.45] text-[#E6F0F6]";

function FromArya({ children, avatar }: { children: React.ReactNode; avatar?: React.ReactNode }) {
  return (
    <span className="ay-in flex items-end gap-2">
      {avatar ?? <AryaMark />}
      {children}
    </span>
  );
}

function Message({ m, booked }: { m: AryaStep; booked: boolean }) {
  if (m.who === "sep") {
    return <span className="ay-in self-center rounded-full bg-white/[.06] px-3 py-1 text-[11.5px] font-semibold tracking-[.04em] text-[#A9C2D4]">{m.text}</span>;
  }
  if (m.who === "me") {
    return <span className="ay-in max-w-[82%] self-end rounded-[18px_18px_4px_18px] bg-[#22DDE0] px-3.5 py-2.5 leading-[1.45] text-[#072338]">{m.text}</span>;
  }
  switch (m.kind) {
    case "text":
      return (
        <FromArya>
          <span className={`flex max-w-[86%] flex-col gap-2 ${ARYA_BUBBLE}`}>
            <span>{m.text}</span>
            {m.note && (
              <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-[#6BEDEF] px-2.5 py-[3px] text-xs font-bold text-[#072338]">
                <Path d={CHECK} size={12} width={3} />
                {m.note}
              </span>
            )}
          </span>
        </FromArya>
      );
    case "trip":
      return (
        <FromArya>
          <span className="flex max-w-[86%] flex-1 flex-col overflow-hidden rounded-[18px_18px_18px_4px] bg-white text-[#0D2436]">
            <span className="relative block h-28 w-full">
              <Image src="/b4/px-bali-resort.webp" alt="A pool resort in Kuta" fill sizes="360px" className="object-cover" />
            </span>
            <span className="flex flex-col gap-0.5 px-3 py-2.5">
              <strong className="text-[15.5px]">Bali for two · 8–14 May</strong>
              <span className="text-[12.5px] text-[#566E85]">Flights, resort, a private car, 5 experiences</span>
              <span className="mt-1.5 flex items-center justify-between">
                <strong className="num text-[17px]">
                  ₹1,42,800 <span className="text-xs font-medium text-[#566E85]">for 2, all-in</span>
                </strong>
                <span className="rounded-full bg-[#E3F5EE] px-[9px] py-[3px] text-xs font-bold text-[#0B7A57]">Under budget</span>
              </span>
            </span>
          </span>
        </FromArya>
      );
    case "choice":
      return (
        <FromArya>
          <span className={`flex max-w-[86%] flex-col gap-2 ${ARYA_BUBBLE}`}>
            <span>{m.text}</span>
            <span className="flex flex-col gap-1.5">
              {ARYA_OPTIONS.map(([t, v], i) => (
                <span
                  key={t}
                  className={`flex justify-between gap-2.5 rounded-xl px-3 py-[9px] text-[13px] font-semibold ${
                    i === 0
                      ? booked
                        ? "border border-[#22DDE0] bg-[#22DDE0] text-[#072338]"
                        : "border border-white bg-white text-[#072338]"
                      : `border border-white/25 bg-transparent text-[#E6F0F6] ${booked ? "opacity-45" : ""}`
                  }`}
                >
                  <span>{t}</span>
                  <span className="num">{v}</span>
                </span>
              ))}
            </span>
          </span>
        </FromArya>
      );
    case "receipt":
      return (
        <FromArya>
          <span className="flex max-w-[86%] flex-1 flex-col overflow-hidden rounded-[18px_18px_18px_4px] bg-white text-[#0D2436]">
            <span className="flex items-center gap-2 bg-[#E3F5EE] px-3 py-[9px] text-[13px] font-bold text-[#0B7A57]">
              <span className="grid size-5 place-items-center rounded-full bg-[#0B7A57] text-white">
                <Path d={CHECK} size={12} width={3} />
              </span>
              Booked. All 7 pieces confirmed.
            </span>
            <span className="flex flex-col gap-1.5 px-3 py-2.5 text-[12.5px] text-[#3F5A72]">
              {["Flights · BLR → DPS, 2 seats", "Kuta pool resort · 6 nights", "Car + sunset cruise + 4 experiences"].map((line) => (
                <span key={line} className="flex justify-between">
                  <span>{line}</span>
                  <span className="font-semibold text-[#0B7A57]">Confirmed</span>
                </span>
              ))}
              <span className="flex items-baseline justify-between border-t border-[#E8EEF4] pt-2 text-[#0D2436]">
                <strong>Paid</strong>
                <strong className="num text-base">₹1,49,000</strong>
              </span>
              <span className="text-[11.5px] text-[#566E85]">PNR and hotel refs unlock 6 days before you fly.</span>
            </span>
          </span>
        </FromArya>
      );
    case "alert":
      return (
        <FromArya>
          <span className={`flex max-w-[86%] flex-col gap-2 ${ARYA_BUBBLE}`}>
            <span className="flex items-start gap-2.5">
              <span className="grid size-[30px] flex-none place-items-center rounded-[10px] bg-[rgba(34,221,224,.18)]">
                <Path d="M2 16l20-6-20-6 4 6-4 6zM6 10h8" size={16} stroke="#6BEDEF" />
              </span>
              <span className="flex flex-col gap-[3px]">
                <strong className="text-[14.5px] text-white">{m.title}</strong>
                <span>{m.text}</span>
              </span>
            </span>
          </span>
        </FromArya>
      );
    case "human":
      return (
        <FromArya avatar={<Image src={IMG.rahul} alt="" width={24} height={24} className="size-6 flex-none rounded-full object-cover" />}>
          <span className="flex max-w-[86%] flex-col gap-2 rounded-[18px_18px_18px_4px] border border-[rgba(107,237,239,.35)] bg-[rgba(107,237,239,.12)] px-3.5 py-2.5 leading-[1.45] text-[#E6F0F6]">
            <span className="text-[11.5px] font-bold text-[#6BEDEF]">Rahul · your trip expert, on WhatsApp</span>
            <span>{m.text}</span>
          </span>
        </FromArya>
      );
  }
}

/** Plays the scripted conversation: typing dots, drafts in the composer, then the message. */
function useConversation() {
  const [n, setN] = useState(0);
  const [typing, setTyping] = useState(false);
  const [draftN, setDraftN] = useState(-1);
  const [paused, setPaused] = useState(false);
  // The timer reads the latest state through a ref (one long-lived timer, not one per render).
  const state = useRef({ n, typing, draftN, paused });
  useEffect(() => {
    state.current = { n, typing, draftN, paused };
  }, [n, typing, draftN, paused]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = state.current;
      if (s.paused) return void (timer = setTimeout(tick, 400));
      if (s.n >= ARYA_SCRIPT.length) {
        setN(0);
        setTyping(false);
        return void (timer = setTimeout(tick, 900));
      }
      const step = ARYA_SCRIPT[s.n];
      if (step.who === "arya" && !s.typing) {
        setTyping(true);
        return void (timer = setTimeout(tick, step.kind === "text" || step.kind === "human" ? 1200 : 1500));
      }
      if (step.who === "me" && s.draftN !== s.n) {
        setDraftN(s.n);
        return void (timer = setTimeout(tick, 1100));
      }
      setN(s.n + 1);
      setTyping(false);
      setDraftN(-1);
      timer = setTimeout(tick, step.hold ?? (step.who === "sep" ? 900 : 1700));
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, []);

  const jump = useCallback((stage: number) => {
    setN(ARYA_STARTS[stage]);
    setTyping(false);
    setDraftN(-1);
  }, []);
  return { n, typing, draftN, paused, setPaused, jump };
}

export function AryaSection() {
  const { n, typing, draftN, paused, setPaused, jump } = useConversation();
  const shown = ARYA_SCRIPT.slice(0, Math.min(n, ARYA_SCRIPT.length));
  const cur = n > 0 ? ARYA_SCRIPT[n - 1].st : 0;
  const draft = draftN >= 0 && ARYA_SCRIPT[draftN]?.who === "me" ? (ARYA_SCRIPT[draftN] as { text: string }).text : null;

  return (
    <section id="b4-arya" aria-labelledby="b4-arya-h" className="bg-[#072338] px-4 py-11 md:px-10 md:py-[104px]">
      <div className="mx-auto grid max-w-[1200px] items-center gap-7 md:grid-cols-[1.05fr_.95fr] md:gap-[72px]">
        <div className="flex flex-col gap-3.5 md:gap-5">
          <span className="inline-flex items-center gap-2.5">
            <span className="md:hidden">
              <AryaMark size={34} fontSize={19} />
            </span>
            <span className="hidden md:block">
              <AryaMark size={44} fontSize={24} />
            </span>
            <span className="text-[13px] font-semibold text-[#6BEDEF] md:text-[14px]">Meet Arya</span>
          </span>
          <h2 id="b4-arya-h" className="font-display m-0 text-[30px] font-medium leading-[1.1] tracking-[-0.015em] text-white md:text-[46px]">
            One chat. Your whole trip.
          </h2>
          <p className="m-0 max-w-[460px] text-[15.5px] leading-normal text-[#C9DAE6] md:text-[19px]">
            Arya plans it, books it and stays with you till you’re home.
          </p>
          <ol aria-label="What Arya does" className="m-0 mt-1 flex max-w-[480px] list-none flex-col gap-2 p-0 md:mt-2 md:gap-2.5">
            {ARYA_STAGES.map((stage, i) => {
              const on = i === cur;
              return (
                <li key={stage.title}>
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    aria-current={on ? "step" : undefined}
                    className="flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border px-3.5 py-3 text-left transition-[background,border-color] duration-[400ms] md:px-[18px] md:py-4"
                    style={{ background: on ? "rgba(34,221,224,.10)" : "transparent", borderColor: on ? "rgba(34,221,224,.45)" : "rgba(255,255,255,.10)" }}
                  >
                    <span
                      className="grid size-8 flex-none place-items-center rounded-full text-sm font-extrabold transition-colors duration-[400ms] md:size-9"
                      style={{ background: on ? "#22DDE0" : "rgba(255,255,255,.08)", color: on ? "#072338" : "#A9C2D4" }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <strong className="text-[15.5px] transition-colors duration-[400ms] md:text-[17.5px]" style={{ color: on ? "#fff" : "#C9DAE6" }}>
                        {stage.title}
                      </strong>
                      <span className="text-[13.5px] leading-[1.4] transition-colors duration-[400ms] md:text-[15px]" style={{ color: on ? "#C9DAE6" : "#8FA9BD" }}>
                        {stage.desc}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <Link
            href={LINKS.arya}
            className="mt-1 self-start rounded-full bg-[#22DDE0] px-[22px] py-[13px] text-[15px] font-bold text-[#072338] no-underline md:mt-2 md:px-7 md:py-[15px] md:text-base"
          >
            Talk to Arya
          </Link>
        </div>

        <div
          role="region"
          aria-label="Animated example: planning, booking and travelling with Arya"
          className="flex flex-col gap-3 rounded-[22px] border border-white/[.12] bg-[#0B3050] p-3.5 shadow-[0_30px_70px_rgba(0,0,0,.25)] md:rounded-[28px] md:p-5"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex">
              <AryaMark size={38} fontSize={20} />
              <span className="ay-live absolute -bottom-px -right-px size-[11px] rounded-full border-2 border-[#0B3050] bg-[#22DDE0]" aria-hidden="true" />
            </span>
            <span className="flex flex-1 flex-col">
              <strong className="text-[14.5px] text-white">Arya</strong>
              <span className="text-[11.5px] text-[#6BEDEF]">{typing ? "typing…" : ARYA_STAGES[cur].status}</span>
            </span>
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              aria-label={paused ? "Play the conversation" : "Pause the conversation"}
              className="grid size-9 cursor-pointer place-items-center rounded-full border border-white/[.22] bg-transparent text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={paused ? "M7 4l13 8-13 8z" : "M6 4h4v16H6zM14 4h4v16h-4z"} />
              </svg>
            </button>
          </div>
          <div role="group" aria-label="Jump to a part of the trip" className="grid grid-cols-3 gap-2">
            {ARYA_STAGES.map((stage, i) => (
              <button
                key={stage.label}
                type="button"
                onClick={() => jump(i)}
                aria-current={i === cur ? "step" : undefined}
                className="flex cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left"
              >
                <span className="block h-[3px] overflow-hidden rounded-full bg-white/[.16]">
                  <span
                    className="ay-bar block h-full bg-[#22DDE0]"
                    style={{ width: `${Math.round(Math.max(0, Math.min(1, (n - ARYA_STARTS[i]) / (ARYA_ENDS[i] - ARYA_STARTS[i]))) * 100)}%` }}
                  />
                </span>
                <span className="text-xs font-bold tracking-[.04em]" style={{ color: i === cur ? "#fff" : "#7C90A3" }}>
                  {stage.label}
                </span>
              </button>
            ))}
          </div>
          <div
            className="relative flex h-[400px] flex-col justify-end gap-2.5 overflow-hidden text-[13.5px] md:h-[470px] md:text-[15px]"
            style={{ maskImage: "linear-gradient(180deg, transparent 0, #000 56px)", WebkitMaskImage: "linear-gradient(180deg, transparent 0, #000 56px)" }}
          >
            {shown.map((m, i) => (
              <Message key={i} m={m} booked={n >= 8} />
            ))}
            {typing && (
              <span className="ay-in flex items-end gap-2" aria-hidden="true">
                <AryaMark />
                <span className="inline-flex gap-1 rounded-[18px_18px_18px_4px] border border-white/[.14] bg-white/[.08] px-3.5 py-3">
                  <span className="ay-dot" />
                  <span className="ay-dot" />
                  <span className="ay-dot" />
                </span>
              </span>
            )}
          </div>
          <div aria-hidden="true" className="flex items-center gap-2.5 rounded-full border border-white/[.12] bg-white/[.06] py-1.5 pl-4 pr-1.5">
            <span className="flex-1 truncate text-sm" style={{ color: draft ? "#fff" : "#7C90A3" }}>
              {draft ?? "Message Arya…"}
            </span>
            <span className="grid size-[34px] flex-none place-items-center rounded-full bg-[#22DDE0]">
              <Path d="M12 19V5M5 12l7-7 7 7" size={15} stroke="#072338" width={2.4} />
            </span>
          </div>
          <span className="text-center text-[11.5px] text-[#7C90A3]">Example conversation · an illustration of how Arya works</span>
        </div>
      </div>
    </section>
  );
}
