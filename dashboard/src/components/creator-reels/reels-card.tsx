"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, Pencil, Plus, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty, ErrorNote } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { unwrap, type Schemas } from "@/lib/api/client";
import { reelLink, rupees, withoutScheme } from "@/lib/creators";

import { useActing } from "./acting";
import { ItinerarySheet } from "./itinerary-sheet";
import { copyText } from "@/lib/clipboard";

type Link = Schemas["CreatorLinkRead"];

const STATE: Record<Link["status"], { label: string; tone: Tone }> = {
  waiting: { label: "Waiting for reel", tone: "warn" },
  unread: { label: "No itinerary yet", tone: "neutral" },
  building: { label: "Processing", tone: "info" },
  failed: { label: "Couldn't read it", tone: "danger" },
  ready: { label: "Not published", tone: "neutral" },
  published: { label: "Published", tone: "ok" },
};

/** Change a reel link: its reel links, its publishing, and re-reading it. */
function useLinkActions(link: Link) {
  const { api, linksKey, actAs } = useActing();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: linksKey });
  const patch = useMutation({
    mutationFn: async (body: Schemas["CreatorLinkUpdate"]) =>
      unwrap(await api.PATCH("/creator/links/{link_id}", { params: { path: { link_id: link.id } }, body })),
    onSuccess: refresh,
  });
  const build = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/creator/links/{link_id}/build", { params: { path: { link_id: link.id } } })),
    onSuccess: refresh,
  });
  // A video file instead of a link: for when YouTube (or Instagram) can't be read by the server.
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch(`/api/reel-upload?link=${link.id}`, {
        method: "POST",
        headers: { "content-type": file.type || "video/mp4", "x-reel-filename": file.name, ...actAs },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The upload failed.");
      return data as Link;
    },
    onSuccess: refresh,
  });
  return { patch, build, upload };
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
        copyText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
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
  const { api, linksKey } = useActing();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [made, setMade] = useState<Link | null>(null);

  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST("/creator/links", { body: { label: label.trim() } })),
    onSuccess: (link) => {
      queryClient.invalidateQueries({ queryKey: linksKey });
      setMade(link);
    },
  });

  return (
    <Modal title="Create referral link" onClose={onClose}>
      <h2 className="text-xl">{made ? "Your link is ready" : "Create referral link"}</h2>
      <p className="mt-1 text-sm text-muted">
        {made
          ? "Put it in the reel's caption or bio. Once the reel is posted, open its card and add the reel's link."
          : "Give the reel a title. We'll make a short link for it."}
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
function ReelCard({ link, onOpen, onEdit }: { link: Link; onOpen: () => void; onEdit: () => void }) {
  const state = STATE[link.status];
  const cover = link.thumbnail_image_url ?? link.cover_image_url;
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        className="relative flex aspect-[3/4] w-full flex-col justify-between overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand-soft via-surface-2 to-surface p-3.5 text-left transition hover:border-brand hover:shadow-card focus-visible:outline-2 focus-visible:outline-brand"
      >
        {cover && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- backend media */}
            <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />
            <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />
          </>
        )}
        <span className="relative flex items-start justify-between gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          <span className="size-8 flex-none" />
        </span>
        <span className="relative flex flex-col gap-1">
          <strong className={`line-clamp-3 text-base leading-snug ${cover ? "text-white" : ""}`}>{link.label}</strong>
          <span
            className={`flex items-center gap-1 text-xs ${cover ? "text-white/85" : "text-muted"}`}
            title={`${link.stats.visits} ${link.stats.visits === 1 ? "visit" : "visits"}`}
          >
            <Eye className="size-3.5" aria-hidden="true" /> {link.stats.visits}
            <span className="sr-only">{link.stats.visits === 1 ? "visit" : "visits"}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit reel"
        title="Edit reel"
        className="absolute right-3.5 top-3.5 flex size-8 items-center justify-center rounded-full bg-surface/85 text-brand transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand"
      >
        <Pencil className="size-4" />
      </button>
    </li>
  );
}

/** Everything about one reel: its link, its numbers, where it's posted, and its itinerary. */
function ReelModal({
  link,
  onOpenItinerary,
  onClose,
}: {
  link: Link;
  onOpenItinerary: () => void;
  onClose: () => void;
}) {
  const { patch, build, upload } = useLinkActions(link);
  const fileRef = useRef<HTMLInputElement>(null);
  const [instagram, setInstagram] = useState(link.instagram_url ?? "");
  const [youtube, setYoutube] = useState(link.youtube_url ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const state = STATE[link.status];
  const building = link.status === "building";
  // No itinerary yet: saving starts one, and the creator says whether it publishes itself.
  const fresh = ["waiting", "unread", "failed"].includes(link.status);
  const hasItinerary = link.status === "ready" || link.status === "published";

  const save = useMutation({
    // `publish`: true = publish as soon as it's ready, false = keep it as a draft, undefined =
    // leave that choice alone (the itinerary is already made).
    mutationFn: async (publish: boolean | undefined) => {
      if (!instagram.trim() && !youtube.trim()) {
        throw new Error("Add your Instagram or YouTube link — one of them is needed.");
      }
      return patch.mutateAsync({
        instagram_url: instagram.trim(),
        youtube_url: youtube.trim(),
        ...(publish === undefined ? {} : { auto_publish: publish }),
      });
    },
    onMutate: () => setProblem(null),
    onSuccess: (updated) => {
      setInstagram(updated.instagram_url ?? "");
      setYoutube(updated.youtube_url ?? "");
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
        <div className="flex items-center gap-3">
          {(link.thumbnail_image_url ?? link.cover_image_url) && (
            // eslint-disable-next-line @next/next/no-img-element -- backend media
            <img src={(link.thumbnail_image_url ?? link.cover_image_url)!} alt="" className="h-16 w-12 flex-none rounded-lg object-cover" />
          )}
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
            // Enter saves the way the first button does.
            save.mutate(fresh ? true : undefined);
          }}
        >
          <div>
            <h3 className="text-sm font-semibold">Where did you post it?</h3>
            <p className="text-sm text-muted">
              Add the reel&rsquo;s link from Instagram or YouTube — one is needed, or both. We make your itinerary from it.
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
          {problem && <ErrorNote error={problem} />}
          {fresh ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="submit" disabled={save.isPending || building}>
                {save.isPending ? "Saving…" : "Save and publish"}
              </Button>
              <Button type="button" variant="secondary" disabled={save.isPending || building} onClick={() => save.mutate(false)}>
                Save as draft
              </Button>
              <p className="text-xs text-muted sm:col-span-2">
                We process the reel in the background. &ldquo;Save and publish&rdquo; publishes it as soon as it&rsquo;s
                ready; &ldquo;Save as draft&rdquo; keeps it unpublished until you publish it.
              </p>
            </div>
          ) : (
            <Button type="submit" disabled={save.isPending || building}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </form>

        {building && (
          <div role="status" aria-label="Processing" className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
            <span className="size-5 flex-none animate-spin rounded-full border-2 border-border border-t-brand" />
            <p className="text-sm">
              <strong className="block">Processing your reel…</strong>
              <span className="text-muted">
                This takes a minute or two. You can close this window: it will show Published or Not published when
                it&rsquo;s done.
              </span>
            </p>
          </div>
        )}

        {link.status === "failed" && (
          <div className="flex flex-col gap-3 rounded-2xl bg-danger-soft p-4">
            <p className="text-sm text-danger">{link.error || "We couldn't read that reel."}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={build.isPending} onClick={() => build.mutate()}>
                {build.isPending ? "Starting…" : "Try again"}
              </Button>
              <Button type="button" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Upload the video instead
              </Button>
            </div>
          </div>
        )}

        {hasItinerary && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-brand-soft p-4">
            <p className="text-sm">
              <strong className="block text-brand">Your itinerary is ready</strong>
              <span className="text-muted">
                {link.status === "published" ? "It's published. Open it to look it over." : "Look it over, then publish."}
              </span>
            </p>
            <Button type="button" className="flex-none whitespace-nowrap" onClick={onOpenItinerary}>
              Open itinerary
            </Button>
          </div>
        )}

        {link.status === "unread" && (
          <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
            <p className="text-sm text-muted">Your link is saved, but no itinerary has been built from it yet.</p>
            <Button type="button" variant="secondary" disabled={build.isPending} onClick={() => build.mutate()}>
              {build.isPending ? "Starting…" : "Build itinerary"}
            </Button>
          </div>
        )}
        {!building && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">
              {upload.isPending
                ? "Uploading your video…"
                : "Can't use a link? Upload the video file and we'll read that instead."}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-none"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" /> Upload video
            </Button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          aria-label="Upload a video file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
        <ErrorNote error={upload.error ?? build.error ?? (patch.error && !problem ? patch.error : null)} />

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted">
            {link.status === "published"
              ? "This reel is published."
              : hasItinerary
                ? "Look it over, then publish."
                : "Publishing opens once the itinerary is ready."}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant={link.status === "published" ? "secondary" : "primary"}
              disabled={!hasItinerary || patch.isPending}
              onClick={() => patch.mutate({ published: link.status !== "published" })}
            >
              {link.status === "published" ? "Unpublish" : "Publish"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** The itinerary sheet for one link, with its publishing wired to the server. It lives at
 *  /<itinerary id>, so it has its own address you can reload, share and go back from. */
export function SheetFor({ link, onClose }: { link: Link; onClose: () => void }) {
  const { patch } = useLinkActions(link);
  return (
    <ItinerarySheet
      link={link}
      busy={patch.isPending}
      onPublished={(next) => patch.mutate({ published: next })}
      onAuto={(next) => patch.mutate({ auto_publish: next })}
      onClose={onClose}
    />
  );
}

/**
 * The Reels card: a "Create link" button, a card for each reel link (click one for its link,
 * numbers, channels and itinerary), as the creator sees it on their own dashboard.
 */
export function ReelsCard({
  approved,
  title = "Reels",
  description,
  blocked,
  children,
}: {
  approved: boolean;
  title?: string;
  description?: string;
  /** Why reels can't be added for this creator, when they can't. */
  blocked?: string;
  children?: ReactNode;
}) {
  const { api, linksKey } = useActing();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const links = useQuery({
    queryKey: linksKey,
    enabled: approved && !blocked,
    retry: false,
    queryFn: async () => unwrap(await api.GET("/creator/links")),
    // While a reel is being read, keep checking how far it got.
    refetchInterval: (query) => (query.state.data?.some((l) => l.status === "building") ? 1500 : false),
  });

  const items = links.data ?? [];
  const open = items.find((l) => l.id === openId) ?? null;
  const sheet = items.find((l) => l.id === sheetId) ?? null;
  const canAdd = approved && !blocked;

  return (
    <>
      <Card>
        <CardHeader
          title={title}
          description={description ?? "Reel links, and the itineraries built from them."}
          action={
            canAdd ? (
              <Button type="button" className="shrink-0 whitespace-nowrap" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Create link
              </Button>
            ) : undefined
          }
        />

        {!approved && (
          <p className="m-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
            Reels can be added once this creator is approved.
          </p>
        )}
        {approved && blocked && <p className="m-5 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">{blocked}</p>}
        {canAdd && links.error && (
          <div className="p-5">
            <ErrorNote error={links.error} />
          </div>
        )}

        {items.length > 0 && (
          <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((link) => (
              <ReelCard
                key={link.id}
                link={link}
                // A reel with an itinerary opens it; one without has nothing to open yet, so its card opens the editor.
                onOpen={() => (link.status === "ready" || link.status === "published" ? setSheetId(link.id) : setOpenId(link.id))}
                onEdit={() => setOpenId(link.id)}
              />
            ))}
          </ul>
        )}

        {items.length === 0 && canAdd && !links.isLoading && !links.error && (
          <Empty title="No reels yet">Create a link, then add the reel it belongs to.</Empty>
        )}

        {children}
      </Card>

      {creating && <CreateLinkModal onClose={() => setCreating(false)} />}
      {open && !sheet && (
        <ReelModal key={open.id} link={open} onOpenItinerary={() => setSheetId(open.id)} onClose={() => setOpenId(null)} />
      )}
      {sheet && <SheetFor link={sheet} onClose={() => setSheetId(null)} />}
    </>
  );
}
