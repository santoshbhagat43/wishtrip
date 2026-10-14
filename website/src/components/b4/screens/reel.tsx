"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError, api, errorMessage, unwrap, type Schemas } from "@/lib/api/client";

import { IMG, LINKS } from "../data";
import { CARD, DonePill, FlowHeader, Kicker } from "../flow";
import { KIND_COLORS, type Kind } from "../flow-data";
import { CHECK, Path } from "../icons";

type ReelImport = Schemas["ReelImportRead"];
type ReelContent = Schemas["ReelContentRead"];
type ReelPlace = Schemas["ReelPlace"];

const STEPS: [step: ReelImport["step"], label: string][] = [
  ["downloading", "Watching the reel"],
  ["reading_screen", "Reading the text on screen"],
  ["listening", "Listening to the voice-over"],
  ["finding_places", "Finding the places"],
];

const KIND: Record<string, Kind> = { stay: "Stay", food: "Food" };

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

/** What the traveller sends to start planning, with only the places they kept. */
function seedMessage(content: ReelContent, kept: ReelPlace[]) {
  const names = kept.filter((p) => p.kind !== "area").map((p) => p.location_name ?? p.name);
  let text = `Plan a trip to ${content.destination_name || "this place"} based on @${content.creator_handle}'s reel`;
  if (content.days_hint) text += `, about ${content.days_hint} days`;
  if (names.length) text += `. I want to see: ${names.slice(0, 10).join(", ")}`;
  return `${text}.`;
}

/** Step 1: paste a reel; we watch it, read it and list its places. Untick what you don't want. */
export function ReelScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const [job, setJob] = useState<ReelImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef<string | null>(null);

  const pastedUrl = params.get("url");
  const importId = params.get("id");

  // Start an import from ?url=…, or pick one up again from ?id=… (after a refresh).
  useEffect(() => {
    const key = importId ?? pastedUrl;
    if (!key || started.current === key) return;
    started.current = key;
    (async () => {
      try {
        const data = importId
          ? unwrap(await api.GET("/reels/imports/{import_id}", { params: { path: { import_id: importId } } }))
          : unwrap(await api.POST("/reels/imports", { body: { url: pastedUrl! } }));
        setJob(data);
        if (!importId) {
          started.current = data.id;
          router.replace(`${LINKS.reel}?id=${data.id}`);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.push(`/login?next=${encodeURIComponent(`${LINKS.reel}?url=${pastedUrl ?? ""}`)}`);
          return;
        }
        setError(errorMessage(e));
      }
    })();
  }, [importId, pastedUrl, router]);

  // Poll while the worker is on it.
  const busy = job && (job.status === "queued" || job.status === "running");
  useEffect(() => {
    if (!busy || !job) return;
    const timer = setInterval(async () => {
      const r = await api.GET("/reels/imports/{import_id}", { params: { path: { import_id: job.id } } });
      if (r.data) setJob(r.data);
    }, 1500);
    return () => clearInterval(timer);
  }, [busy, job]);

  let body: React.ReactNode;
  if (error || job?.status === "failed") body = <PasteForm error={error ?? job?.error ?? ""} />;
  else if (!importId && !pastedUrl) body = <PasteForm />;
  else if (job?.status === "done" && job.content) body = <ReelResult job={job} content={job.content} />;
  else body = <Working job={job} />;

  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader step={1} title="Reel to trip" subtitle="Step 1 of 3" back={LINKS.home} />
      {body}
    </div>
  );
}

function PasteForm({ error = "" }: { error?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 pb-16 pt-8 md:pt-16">
      <div className="flex flex-col gap-2">
        <Kicker teal>REEL TO TRIP</Kicker>
        <h1 className="font-display m-0 text-[32px] font-medium leading-[1.1] md:text-5xl">Paste a reel. Get the trip.</h1>
        <p className="m-0 text-[15px] leading-[1.6] text-[#3F5A72] md:text-[17px]">
          We watch it, read the text on screen, listen to the voice-over and list every place, checked against what we know.
        </p>
      </div>
      {error && (
        <div role="alert" className="rounded-2xl border border-[#F2C7C0] bg-[#FBE9E6] px-4 py-3 text-sm font-semibold text-[#B8362A]">
          {error}
        </div>
      )}
      <form
        className={`${CARD} flex flex-col gap-3 p-4 md:flex-row md:items-center md:p-3`}
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) router.push(`${LINKS.reel}?url=${encodeURIComponent(url.trim())}`);
        }}
      >
        <label htmlFor="reel-url" className="sr-only">
          Instagram reel link
        </label>
        <input
          id="reel-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          placeholder="instagram.com/reel/…"
          className="min-w-0 flex-1 rounded-[14px] border-[1.5px] border-[#E3DCD2] px-3.5 py-[13px] text-base text-[#0D2436] outline-none focus:border-[#0A7C80]"
        />
        <button type="submit" className="cursor-pointer whitespace-nowrap rounded-full border-0 bg-[#072338] px-6 py-3.5 text-base font-semibold text-white">
          Get the trip →
        </button>
      </form>
      <span className="text-[13px] text-[#566E85]">
        Works with public Instagram reels. Rather type it?{" "}
        <Link href={LINKS.arya} className="font-semibold text-[#0A7C80] underline">
          Tell Arya the places
        </Link>
      </span>
    </main>
  );
}

function Working({ job }: { job: ReelImport | null }) {
  const current = STEPS.findIndex(([s]) => s === job?.step);
  return (
    <main className="mx-auto flex max-w-[560px] flex-col items-center gap-6 px-4 pb-16 pt-10 text-center md:pt-20">
      <div className="relative grid h-[200px] w-[113px] place-items-center overflow-hidden rounded-2xl bg-[#0D2436] shadow-[0_20px_46px_rgba(13,36,54,.2)]">
        <span className="size-12 animate-pulse rounded-full bg-white/15" />
      </div>
      <h1 className="font-display m-0 text-[28px] font-medium leading-[1.15] md:text-4xl">Watching your reel…</h1>
      <ol aria-live="polite" className="m-0 flex w-full max-w-[340px] list-none flex-col gap-2.5 p-0 text-left">
        {STEPS.map(([step, label], i) => {
          const done = i < current;
          const now = i === current || (current === -1 && i === 0);
          return (
            <li key={step} className={`flex items-center gap-3 text-[15px] ${done ? "text-[#0B7A57]" : now ? "font-semibold text-[#0D2436]" : "text-[#8A7F72]"}`}>
              <span
                aria-hidden="true"
                className={`grid size-6 flex-none place-items-center rounded-full ${done ? "bg-[#E3F5EE]" : now ? "border-2 border-[#22DDE0]" : "border-[1.5px] border-[#E3DCD2]"}`}
              >
                {done && <Path d={CHECK} size={12} stroke="#0B7A57" width={2.6} />}
                {now && <span className="size-2 animate-pulse rounded-full bg-[#22DDE0]" />}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-[13px] text-[#566E85]">This takes about a minute. You can keep this page open.</p>
    </main>
  );
}

function ReelResult({ job, content }: { job: ReelImport; content: ReelContent }) {
  const [off, setOff] = useState<Record<string, boolean>>({});
  const kept = content.places.filter((p) => !off[p.name]);
  const verified = content.places.filter((p) => p.verified).length;
  const planHref = job.chat_session_id
    ? `/plan?session=${job.chat_session_id}&prompt=${encodeURIComponent(seedMessage(content, kept))}`
    : LINKS.arya;
  const progress = [
    "Watched the reel",
    ...(content.screen_lines ? [`Read ${content.screen_lines} lines on screen`] : []),
    ...(content.has_voice ? ["Heard the voice-over"] : []),
    `Found ${content.places.length} ${content.places.length === 1 ? "place" : "places"}`,
  ];

  const banner = (
    <div className="flex flex-col items-stretch gap-3 rounded-[20px] bg-[#072338] p-4 text-white md:flex-row md:items-center md:gap-[22px] md:px-6 md:py-5">
      <span className="flex flex-col gap-0.5">
        <Kicker className="text-[#6BEDEF]!">FROM @{content.creator_handle.toUpperCase()}’S REEL</Kicker>
        <strong className="font-display text-[26px] font-medium leading-[1.1] md:text-[32px]">
          {content.destination_name || "Your trip"} · {kept.length} {kept.length === 1 ? "place" : "places"}
        </strong>
        <span className="mt-0.5 text-[13px] text-[#C9DAE6]">
          {verified} of {content.places.length} checked by our team. Prices show up once you pick dates.
        </span>
      </span>
      <Link href={planHref} className="whitespace-nowrap rounded-full bg-[#22DDE0] px-[26px] py-3.5 text-center text-base font-bold text-[#072338] no-underline md:ml-auto">
        Build my trip →
      </Link>
    </div>
  );

  const places = content.places.length ? (
    content.places.map((p) => {
      const kind = KIND[p.kind] ?? "Place";
      const [kc, kb] = KIND_COLORS[kind];
      const on = !off[p.name];
      return (
        <label
          key={p.name}
          className="flex cursor-pointer items-center gap-3 rounded-2xl border bg-white px-3 py-2.5 transition-opacity"
          style={{ borderColor: on ? "#BDEFF0" : "#E8E1D8", opacity: on ? 1 : 0.5 }}
        >
          <input type="checkbox" checked={on} onChange={() => setOff({ ...off, [p.name]: on })} className="size-[22px] flex-none accent-[#0A7C80]" />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <strong className="text-sm md:text-[15.5px]">{p.location_name ?? p.name}</strong>
            {p.evidence && <span className="line-clamp-2 text-xs italic text-[#566E85] md:text-[13px]">“{p.evidence}”</span>}
            <span
              className={`self-start rounded-full px-2 py-0.5 text-[10.5px] font-bold ${p.verified ? "bg-[#E3F5EE] text-[#0B7A57]" : "bg-[#FDF3E1] text-[#9A6412]"}`}
            >
              {p.verified ? "Checked by wishtrip" : "From the reel · not checked yet"}
            </span>
          </span>
          <span className="flex flex-col items-end gap-[5px]">
            <span className="rounded-full px-[9px] py-[3px] text-[11px] font-bold" style={{ color: kc, background: kb }}>
              {kind}
            </span>
            {p.t != null && <span className="text-[11px] font-semibold text-[#566E85]">▶ {clock(p.t)}</span>}
          </span>
        </label>
      );
    })
  ) : (
    <p className="m-0 rounded-2xl bg-[#F4EFE8] p-4 text-sm text-[#3F5A72]">
      We couldn’t find named places in this reel. Tell Arya what caught your eye and she’ll plan around it.
    </p>
  );

  const tips = content.tips.length > 0 && (
    <div className={`${CARD} flex flex-col gap-2 p-4`}>
      <Kicker>TIPS FROM THE CREATOR</Kicker>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-[#3F5A72]">
        {content.tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );

  const thumb = (sizes: string) =>
    content.thumbnail_url ? (
      // eslint-disable-next-line @next/next/no-img-element -- served by the backend under /media
      <img src={content.thumbnail_url} alt={`Cover of @${content.creator_handle}’s reel`} sizes={sizes} className="absolute inset-0 size-full object-cover" />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={IMG.mark} alt="" className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 opacity-60" />
    );
  const handle = (
    <a href={content.url} target="_blank" rel="noreferrer" className="text-white no-underline">
      @{content.creator_handle}
    </a>
  );
  const summary = `${content.summary ? `${content.summary} ` : ""}Untick anything you don’t want.`;

  return (
    <>
      {/* Phones */}
      <div className="md:hidden">
        <section className="flex items-start gap-3.5 p-4">
          <div className="relative h-[210px] w-[118px] flex-none overflow-hidden rounded-2xl bg-[#0D2436] shadow-[0_20px_46px_rgba(13,36,54,.2)]">
            {thumb("118px")}
            <span className="absolute inset-x-0 bottom-0 truncate whitespace-nowrap bg-gradient-to-b from-transparent to-black/70 px-2 py-2.5 text-[10.5px] font-semibold text-white">
              {handle}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col items-start gap-1.5">
              {progress.map((t) => (
                <DonePill key={t}>{t}</DonePill>
              ))}
            </div>
            <h1 className="font-display mt-1 text-[27px] font-medium leading-[1.12]">Here’s the trip inside this reel</h1>
          </div>
        </section>
        <p className="m-0 px-4 pb-3 text-sm leading-[1.55] text-[#3F5A72]">{summary}</p>
        <section className="px-4 pb-3.5">{banner}</section>
        <section className="flex flex-col gap-2 px-4 pb-2.5 pt-1">
          <div className="flex items-baseline justify-between">
            <Kicker>ON YOUR BOARD</Kicker>
            <span className="text-[12.5px] text-[#566E85]">
              {kept.length} of {content.places.length} kept
            </span>
          </div>
          {places}
        </section>
        <section className="flex flex-col gap-2.5 px-4 pb-10 pt-3.5">{tips}</section>
      </div>

      {/* Desktop */}
      <main className="mx-auto hidden max-w-[1240px] grid-cols-[320px_1fr] items-start gap-11 px-10 pb-[72px] pt-10 md:grid">
        <aside className="sticky top-[100px] flex flex-col gap-3.5">
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[28px] bg-[#0D2436] shadow-[0_20px_46px_rgba(13,36,54,.2)]">
            {thumb("320px")}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-black/70 p-4 text-[13px] font-semibold text-white">{handle}</span>
          </div>
          <div className={`${CARD} flex items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-sm`}>
            <span className="min-w-0 flex-1 truncate text-[#566E85]">{content.url.replace(/^https:\/\/(www\.)?/, "")}</span>
            <Link href={LINKS.reel} className="font-bold text-[#0A7C80] underline">
              Change
            </Link>
          </div>
        </aside>
        <section className="flex flex-col gap-[22px]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {progress.map((t) => (
                <DonePill key={t}>{t}</DonePill>
              ))}
            </div>
            <h1 className="font-display m-0 text-5xl font-medium leading-[1.08]">We watched it. Here’s your trip.</h1>
            <p className="m-0 text-[17px] leading-[1.6] text-[#3F5A72]">{summary}</p>
          </div>
          {banner}
          <div className={`${CARD} flex flex-col gap-3 rounded-3xl p-5`}>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={IMG.mark} alt="" width={28} height={28} className="size-7" />
              <strong className="flex-1 text-base">From @{content.creator_handle}’s reel · on your board</strong>
              <span className="text-[13.5px] text-[#566E85]">
                {kept.length} of {content.places.length} kept
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">{places}</div>
          </div>
          {tips}
        </section>
      </main>
    </>
  );
}
