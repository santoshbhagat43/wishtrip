"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Link2, Plus } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { reelLink, rupees, withoutScheme } from "@/lib/creator";
import { relativeTime } from "@/lib/format";

type Link = Schemas["CreatorLinkRead"];

const STEPS = [
  ["Create a link", "One for each reel you're about to post."],
  ["Use it in your reel", "Put it in the caption or your bio."],
  ["Add the reel's URL", "Once it's on Instagram, paste its link here."],
] as const;

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

/**
 * A creator's reel links: make one before posting, use it in the reel, then come back and add the
 * reel's Instagram URL. Each link shows its own numbers.
 */
export function ReelLinks({ approved }: { approved: boolean }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");

  const links = useQuery({
    queryKey: ["creator-links"],
    queryFn: async () => unwrap(await api.GET("/creator/links")),
  });

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/creator/links", {
          body: { label: label.trim() },
        }),
      ),
    onSuccess: () => {
      setLabel("");
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["creator-links"] });
    },
  });

  const items = links.data ?? [];
  const waiting = items.filter((l) => l.status === "waiting").length;

  return (
    <Card>
      <CardHeader
        title="Your reel links"
        description="A short link for each reel, so you can see which one brings travellers in."
        action={
          approved && !creating ? (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Create referral link
            </Button>
          ) : undefined
        }
      />

      <ol className="grid gap-3 px-5 pt-4 sm:grid-cols-3">
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

      {!approved && (
        <p className="m-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
          Reel links unlock as soon as the WishTrip team approves your account.
        </p>
      )}

      {creating && (
        <form
          className="m-5 flex flex-col gap-3 rounded-2xl border border-border bg-surface-2/60 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            What&rsquo;s the reel about?
            <Input
              required
              autoFocus
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Goa beach weekend"
            />
          </label>
          <ErrorNote error={create.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!label.trim() || create.isPending}>
              {create.isPending ? "Creating…" : "Create link"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {links.isLoading ? null : items.length === 0 ? (
        approved && !creating && (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <Link2 className="size-6 text-muted" />
            <p className="text-sm font-medium">No reel links yet</p>
            <p className="text-sm text-muted">Create one before you post your next reel.</p>
          </div>
        )
      ) : (
        <>
          {waiting > 0 && (
            <p className="mx-5 mt-4 text-sm text-muted">
              {waiting} {waiting === 1 ? "link is" : "links are"} waiting for a reel. Once it&rsquo;s posted, add its
              Instagram URL.
            </p>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {items.map((link) => (
              <LinkRow key={link.id} link={link} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function LinkRow({ link }: { link: Link }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const live = link.status === "live";
  const short = reelLink(link.code);

  const save = useMutation({
    mutationFn: async (instagram_url: string) =>
      unwrap(
        await api.PATCH("/creator/links/{link_id}", {
          params: { path: { link_id: link.id } },
          body: { instagram_url },
        }),
      ),
    onSuccess: () => {
      setEditing(false);
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["creator-links"] });
    },
  });

  const showForm = !live || editing;

  return (
    <li className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <strong className="text-base">{link.label}</strong>
            <Badge tone={live ? "ok" : "warn"}>{live ? "Live" : "Waiting for your reel"}</Badge>
          </p>
          <p className="text-sm text-muted">
            {link.destination ? `Opens ${link.destination.name}` : "Opens the WishTrip home page"} · made{" "}
            {relativeTime(link.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded-xl bg-surface-2 px-3 py-2 text-sm">{withoutScheme(short)}</code>
          <CopyButton value={short} />
        </div>

        <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-xl bg-border text-center">
          {(
            [
              ["Visits", link.stats.visits],
              ["Sign-ups", link.stats.signups],
              ["Trips planned", link.stats.trips_planned],
              ["Earned", rupees(link.stats.earned_paise)],
            ] as const
          ).map(([name, value]) => (
            <div key={name} className="bg-surface px-2 py-2">
              <dt className="text-[11px] text-muted">{name}</dt>
              <dd className="text-base font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col justify-center gap-2 lg:items-stretch">
        {live && !editing && (
          <>
            <a href={link.instagram_url ?? "#"} target="_blank" rel="noreferrer">
              <Button type="button" variant="secondary" className="w-full">
                <ExternalLink className="size-4" /> View the reel
              </Button>
            </a>
            <button
              type="button"
              onClick={() => {
                setUrl(link.instagram_url ?? "");
                setEditing(true);
              }}
              className="text-sm text-muted hover:text-text"
            >
              Change or remove the reel
            </button>
          </>
        )}

        {showForm && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(url.trim());
            }}
          >
            <label className="text-sm font-semibold" htmlFor={`reel-${link.id}`}>
              {live ? "Instagram reel URL" : "Posted it? Add the reel"}
            </label>
            <Input
              id={`reel-${link.id}`}
              inputMode="url"
              placeholder="instagram.com/reel/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required={!live}
            />
            <ErrorNote error={save.error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending || (!live && !url.trim())} className="flex-1">
                {save.isPending ? "Saving…" : live ? (url.trim() ? "Save" : "Remove reel") : "Add reel"}
              </Button>
              {editing && (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </li>
  );
}
