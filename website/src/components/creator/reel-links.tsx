"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Play, Plus } from "lucide-react";
import { ItinerarySheet, sampleItinerary, stopCount } from "@/components/creator/itinerary-sheet";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty, ErrorNote } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { reelLink, rupees, withoutScheme } from "@/lib/creator";

type Link = Schemas["CreatorLinkRead"];

/**
 * What a reel also has beyond the stored link. Held in the page for now: the YouTube link, the
 * itinerary and the publishing choices aren't stored by the backend yet, so they last until the
 * page is closed.
 */
type Extras = {
  youtube: string;
  /** Not built yet, being built, or built. */
  itinerary: "none" | "processing" | "ready";
  /** Which of BUILD_STEPS is running. */
  step: number;
  published: boolean;
  /** Publish as soon as the itinerary is built. */
  auto: boolean;
};
const NO_EXTRAS: Extras = { youtube: "", itinerary: "none", step: 0, published: false, auto: false };

/** What happens to a reel once its link is added, in order (shown while the itinerary is built). */
const BUILD_STEPS = [
  "Downloading your reel",
  "Reading the text on screen",
  "Listening to the voice-over",
  "Finding the places",
  "Building your itinerary",
] as const;
const STEP_MS = 1100;

const STEPS = [
  ["Create a link", "One for each reel you're about to post."],
  ["Use it in your reel", "Put it in the caption or your bio."],
  ["Add the reel's URL", "Once it's on Instagram or YouTube, paste its link. We build the itinerary."],
] as const;

/** Where a reel stands, from nothing added to published. */
function stateOf(link: Link, extras: Extras) {
  const hasChannel = Boolean(link.instagram_url || extras.youtube);
  if (!hasChannel) return { label: "Waiting for reel", tone: "warn" as const, hasChannel };
  if (extras.itinerary === "processing") return { label: "Building itinerary", tone: "info" as const, hasChannel };
  if (extras.itinerary === "none") return { label: "No itinerary yet", tone: "neutral" as const, hasChannel };
  if (extras.published) return { label: "Published", tone: "ok" as const, hasChannel };
  return { label: "Ready to publish", tone: "brand" as const, hasChannel };
}

/** Copy a value, and say so for a moment. */
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** The three steps, shown beside the creator's other tools. */
export function ReelLinkSteps() {
  return (
    <Card className="h-fit">
      <CardHeader title="How reel links work" />
      <ol className="flex flex-col gap-4 px-5 pb-5 pt-4">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="flex items-start gap-3">
            <span className="flex size-7 flex-none items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
              {i + 1}
            </span>
            <span className="text-sm">
              <strong className="block">{title}</strong>
              <span className="text-muted">{body}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** A plain modal: Escape or a click outside closes it. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-auto w-full max-w-lg rounded-2xl bg-surface p-6 shadow-card"
      >
        {children}
      </div>
    </div>
  );
}

/** The short link in full, with a copy button. */
function LinkBox({ code }: { code?: string }) {
  const short = code ? reelLink(code) : null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">Your link</span>
      <div className="flex flex-wrap items-center gap-2">
        <code
          aria-label="Your reel link"
          className="min-w-0 break-all rounded-xl bg-surface-2 px-3 py-2.5 text-sm data-[empty]:text-muted"
          data-empty={short ? undefined : ""}
        >
          {short ? withoutScheme(short) : "wishtrip.listnr.co/r/…"}
        </code>
        {short && <CopyButton value={short} />}
      </div>
      {!short && <span className="text-xs text-muted">Your link appears here as soon as you create it.</span>}
    </div>
  );
}

/** Ask for a title, then show the link that was made. */
function CreateLinkModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [made, setMade] = useState<Link | null>(null);

  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST("/creator/links", { body: { label: label.trim() } })),
    onSuccess: (link) => {
      queryClient.invalidateQueries({ queryKey: ["creator-links"] });
      setMade(link);
    },
  });

  return (
    <Modal title="Create referral link" onClose={onClose}>
      <h2 className="text-xl">{made ? "Your link is ready" : "Create referral link"}</h2>
      <p className="mt-1 text-sm text-muted">
        {made
          ? "Put it in your reel's caption or bio. Once the reel is posted, open its card and add the reel's link."
          : "Give the reel a title. We'll make a short link you can use in it."}
      </p>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (made) onClose();
          else create.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Title
          <Input
            required
            autoFocus
            maxLength={120}
            value={label}
            readOnly={Boolean(made)}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Goa beach weekend"
          />
        </label>
        <LinkBox code={made?.code} />
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          {!made && (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!label.trim() || create.isPending}>
            {made ? "Done" : create.isPending ? "Creating…" : "Create link"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** One reel, as a tall card: its title, where it stands, and how many people opened its link. */
function ReelCard({ link, extras, onOpen }: { link: Link; extras: Extras; onOpen: () => void }) {
  const state = stateOf(link, extras);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="relative flex aspect-[3/4] w-full flex-col justify-between overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand-soft via-surface-2 to-surface p-3.5 text-left transition hover:border-brand hover:shadow-card focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className="flex items-start justify-between gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          <span className="flex size-8 flex-none items-center justify-center rounded-full bg-surface/80 text-brand">
            <Play className="size-4" />
          </span>
        </span>
        <span className="flex flex-col gap-1">
          <strong className="line-clamp-3 text-base leading-snug">{link.label}</strong>
          <span className="text-xs text-muted">
            {link.stats.visits} {link.stats.visits === 1 ? "visit" : "visits"} · {link.stats.signups}{" "}
            {link.stats.signups === 1 ? "sign-up" : "sign-ups"}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Everything about one reel: its link, its numbers, where it's posted, and its itinerary. */
function ReelModal({
  link,
  extras,
  onExtras,
  onBuild,
  onOpenItinerary,
  onClose,
}: {
  link: Link;
  extras: Extras;
  onExtras: (next: Extras) => void;
  onBuild: () => void;
  onOpenItinerary: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [instagram, setInstagram] = useState(link.instagram_url ?? "");
  const [youtube, setYoutube] = useState(extras.youtube);
  const [problem, setProblem] = useState<string | null>(null);
  const state = stateOf(link, extras);
  const building = extras.itinerary === "processing";

  const save = useMutation({
    mutationFn: async () => {
      const ig = instagram.trim();
      const yt = youtube.trim();
      if (!ig && !yt) throw new Error("Add your Instagram or YouTube link — one of them is needed.");
      if (yt && !/(^|\/\/|\.)(youtube\.com|youtu\.be)\//i.test(yt)) {
        throw new Error("Paste the link to your YouTube video, like youtube.com/watch?v=…");
      }
      let stored = link.instagram_url ?? "";
      // The Instagram link is stored; an unchanged one isn't sent again.
      if (ig !== stored) {
        const updated = unwrap(
          await api.PATCH("/creator/links/{link_id}", {
            params: { path: { link_id: link.id } },
            body: { instagram_url: ig },
          }),
        );
        stored = updated.instagram_url ?? "";
        setInstagram(stored);
      }
      return { changed: stored !== (link.instagram_url ?? "") || yt !== extras.youtube, youtube: yt };
    },
    onMutate: () => setProblem(null),
    onSuccess: ({ changed, youtube: yt }) => {
      onExtras({ ...extras, youtube: yt });
      queryClient.invalidateQueries({ queryKey: ["creator-links"] });
      // A new or changed reel link means a new itinerary.
      if (changed || extras.itinerary === "none") onBuild();
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : String(e)),
  });

  const stats = [
    ["Visits", link.stats.visits],
    ["Sign-ups", link.stats.signups],
    ["Trips planned", link.stats.trips_planned],
    ["Earned", rupees(link.stats.earned_paise)],
  ] as const;

  return (
    <Modal title={link.label} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <h2 className="flex flex-wrap items-center gap-2 text-xl">
          {link.label} <Badge tone={state.tone}>{state.label}</Badge>
        </h2>

        <LinkBox code={link.code} />

        <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-xl bg-border text-center">
          {stats.map(([name, value]) => (
            <div key={name} className="bg-surface px-2 py-2.5">
              <dt className="text-[11px] text-muted">{name}</dt>
              <dd className="text-base font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div>
            <h3 className="text-sm font-semibold">Where did you post it?</h3>
            <p className="text-sm text-muted">
              Add the reel&rsquo;s link from Instagram or YouTube — one is needed, or both. We&rsquo;ll build your itinerary
              from it.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Instagram reel URL
            <Input
              inputMode="url"
              placeholder="instagram.com/reel/…"
              value={instagram}
              disabled={building}
              onChange={(e) => setInstagram(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            YouTube video URL
            <Input
              inputMode="url"
              placeholder="youtube.com/watch?v=…"
              value={youtube}
              disabled={building}
              onChange={(e) => setYoutube(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand"
              checked={extras.auto}
              onChange={(e) => onExtras({ ...extras, auto: e.target.checked })}
            />
            Publish it automatically once the itinerary is built
          </label>
          {problem && <ErrorNote error={problem} />}
          <Button type="submit" disabled={save.isPending || building}>
            {save.isPending ? "Saving…" : extras.itinerary === "none" ? "Save and build itinerary" : "Save"}
          </Button>
        </form>

        {building && (
          <ol aria-label="Building your itinerary" className="flex flex-col gap-2.5 rounded-2xl bg-surface-2 p-4">
            {BUILD_STEPS.map((label, i) => {
              const done = i < extras.step;
              const active = i === extras.step;
              return (
                <li key={label} className={`flex items-center gap-2.5 text-sm ${done || active ? "" : "text-muted"}`}>
                  <span className="grid size-5 flex-none place-items-center">
                    {done ? (
                      <Check className="size-4 text-ok" />
                    ) : active ? (
                      <span className="size-4 animate-spin rounded-full border-2 border-border border-t-brand" />
                    ) : (
                      <span className="size-2 rounded-full bg-border" />
                    )}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>
        )}

        {extras.itinerary === "ready" && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-brand-soft p-4">
            <p className="text-sm">
              <strong className="block text-brand">Your itinerary is ready</strong>
              <span className="text-muted">
                {sampleItinerary().length} days · {stopCount(sampleItinerary())} stops, made from your reel.
              </span>
            </p>
            <Button type="button" onClick={onOpenItinerary}>
              Open itinerary
            </Button>
          </div>
        )}

        {state.hasChannel && extras.itinerary === "none" && !building && (
          <Button type="button" variant="secondary" onClick={onBuild}>
            Build itinerary
          </Button>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted">
            {extras.published
              ? "This reel is published."
              : extras.itinerary === "ready"
                ? "Look it over, then publish."
                : "Publishing opens once the itinerary is ready."}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant={extras.published ? "secondary" : "primary"}
              disabled={extras.itinerary !== "ready"}
              onClick={() => onExtras({ ...extras, published: !extras.published })}
            >
              {extras.published ? "Unpublish" : "Publish"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The Reels card: a "Create link" button, a card for each reel the creator has made a link for
 * (click one for its link, numbers, channels and itinerary), then whatever the page puts below —
 * the reels travellers pasted into WishTrip.
 */
export function ReelsCard({ approved, children }: { approved: boolean; children?: ReactNode }) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [extras, setExtras] = useState<Record<string, Extras>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const links = useQuery({
    queryKey: ["creator-links"],
    queryFn: async () => unwrap(await api.GET("/creator/links")),
  });

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const update = (id: string, patch: (e: Extras) => Extras) =>
    setExtras((all) => ({ ...all, [id]: patch(all[id] ?? NO_EXTRAS) }));

  /** Build the itinerary: walk through the steps, then it's ready (and published, if asked). */
  const build = (id: string) => {
    update(id, (e) => ({ ...e, itinerary: "processing", step: 0, published: false }));
    BUILD_STEPS.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => {
          if (i < BUILD_STEPS.length - 1) update(id, (e) => ({ ...e, step: i + 1 }));
          else update(id, (e) => ({ ...e, itinerary: "ready", step: BUILD_STEPS.length, published: e.auto }));
        }, STEP_MS * (i + 1)),
      );
    });
  };

  const items = links.data ?? [];
  const open = items.find((l) => l.id === openId) ?? null;
  const sheet = items.find((l) => l.id === sheetId) ?? null;
  const sheetExtras = sheet ? (extras[sheet.id] ?? NO_EXTRAS) : NO_EXTRAS;

  return (
    <>
      <Card>
        <CardHeader
          title="Reels"
          description="Your reel links, and the reels travellers pasted into WishTrip."
          action={
            approved ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Create link
              </Button>
            ) : undefined
          }
        />

        {!approved && (
          <p className="m-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
            Reel links unlock as soon as the WishTrip team approves your account.
          </p>
        )}

        {items.length > 0 && (
          <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((link) => (
              <ReelCard
                key={link.id}
                link={link}
                extras={extras[link.id] ?? NO_EXTRAS}
                onOpen={() => setOpenId(link.id)}
              />
            ))}
          </ul>
        )}

        {items.length === 0 && !children && approved && !links.isLoading && (
          <Empty title="No reels yet">Create a link before you post your next reel.</Empty>
        )}

        {children}
      </Card>

      {creating && <CreateLinkModal onClose={() => setCreating(false)} />}
      {open && !sheet && (
        <ReelModal
          key={open.id}
          link={open}
          extras={extras[open.id] ?? NO_EXTRAS}
          onExtras={(next) => update(open.id, () => next)}
          onBuild={() => build(open.id)}
          onOpenItinerary={() => setSheetId(open.id)}
          onClose={() => setOpenId(null)}
        />
      )}
      {sheet && (
        <ItinerarySheet
          title={sheet.label}
          code={sheet.code}
          sources={[
            ...(sheet.instagram_url ? [{ label: "Instagram", url: sheet.instagram_url }] : []),
            ...(sheetExtras.youtube ? [{ label: "YouTube", url: sheetExtras.youtube }] : []),
          ]}
          published={sheetExtras.published}
          auto={sheetExtras.auto}
          onPublished={(next) => update(sheet.id, (e) => ({ ...e, published: next }))}
          onAuto={(next) => update(sheet.id, (e) => ({ ...e, auto: next }))}
          onClose={() => setSheetId(null)}
        />
      )}
    </>
  );
}
