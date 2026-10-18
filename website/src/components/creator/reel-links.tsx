"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Play, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty, ErrorNote } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { reelLink, rupees, withoutScheme } from "@/lib/creator";

type Link = Schemas["CreatorLinkRead"];

/**
 * What a reel card also shows. Held in the page for now: the YouTube link and the published
 * switch aren't stored by the backend yet, so they last until the page is closed.
 */
type Extras = { youtube: string; published: boolean };
const NO_EXTRAS: Extras = { youtube: "", published: false };

const STEPS = [
  ["Create a link", "One for each reel you're about to post."],
  ["Use it in your reel", "Put it in the caption or your bio."],
  ["Add the reel's URL", "Once it's on Instagram or YouTube, paste its link here."],
] as const;

/** Where a reel stands: no channel yet, ready but private, or published. */
function stateOf(link: Link, extras: Extras) {
  const hasChannel = Boolean(link.instagram_url || extras.youtube);
  if (!hasChannel) return { label: "Waiting for reel", tone: "warn" as const, hasChannel };
  if (extras.published) return { label: "Published", tone: "ok" as const, hasChannel };
  return { label: "Not published", tone: "neutral" as const, hasChannel };
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

/** Everything about one reel: its link, its numbers, where it's posted, and publishing. */
function ReelModal({
  link,
  extras,
  onExtras,
  onClose,
}: {
  link: Link;
  extras: Extras;
  onExtras: (next: Extras) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [instagram, setInstagram] = useState(link.instagram_url ?? "");
  const [youtube, setYoutube] = useState(extras.youtube);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const state = stateOf(link, extras);

  const save = useMutation({
    mutationFn: async () => {
      const ig = instagram.trim();
      const yt = youtube.trim();
      if (!ig && !yt) throw new Error("Add your Instagram or YouTube link — one of them is needed.");
      if (yt && !/(^|\/\/|\.)(youtube\.com|youtu\.be)\//i.test(yt)) {
        throw new Error("Paste the link to your YouTube video, like youtube.com/watch?v=…");
      }
      // The Instagram link is stored; an unchanged one isn't sent again.
      if (ig !== (link.instagram_url ?? "")) {
        const updated = unwrap(
          await api.PATCH("/creator/links/{link_id}", {
            params: { path: { link_id: link.id } },
            body: { instagram_url: ig },
          }),
        );
        setInstagram(updated.instagram_url ?? "");
      }
      onExtras({ ...extras, youtube: yt, published: extras.published && Boolean(ig || yt) });
    },
    onMutate: () => {
      setProblem(null);
      setSaved(false);
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["creator-links"] });
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
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-xl">
            {link.label} <Badge tone={state.tone}>{state.label}</Badge>
          </h2>
        </div>

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
            <p className="text-sm text-muted">Add the reel&rsquo;s link from Instagram or YouTube — one is needed, or both.</p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Instagram reel URL
            <Input
              inputMode="url"
              placeholder="instagram.com/reel/…"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            YouTube video URL
            <Input
              inputMode="url"
              placeholder="youtube.com/watch?v=…"
              value={youtube}
              onChange={(e) => setYoutube(e.target.value)}
            />
          </label>
          {problem && <ErrorNote error={problem} />}
          {saved && !problem && <p className="text-sm font-medium text-ok">Saved.</p>}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </form>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted">
            {extras.published
              ? "This reel is published."
              : state.hasChannel
                ? "Ready when you are."
                : "Add a reel link to publish it."}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant={extras.published ? "secondary" : "primary"}
              disabled={!state.hasChannel}
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
 * (click one for its link, numbers, channels and publishing), then whatever the page puts below —
 * the reels travellers pasted into WishTrip.
 */
export function ReelsCard({ approved, children }: { approved: boolean; children?: ReactNode }) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [extras, setExtras] = useState<Record<string, Extras>>({});
  const links = useQuery({
    queryKey: ["creator-links"],
    queryFn: async () => unwrap(await api.GET("/creator/links")),
  });

  const items = links.data ?? [];
  const open = items.find((l) => l.id === openId) ?? null;

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
      {open && (
        <ReelModal
          key={open.id}
          link={open}
          extras={extras[open.id] ?? NO_EXTRAS}
          onExtras={(next) => setExtras((all) => ({ ...all, [open.id]: next }))}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
