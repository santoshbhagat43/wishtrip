"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Card, CardHeader } from "@/components/ui/card";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api/client";

type Overview = Schemas["CreatorOverview"];

const inputClass =
  "rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[14.5px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

/** "Your channels": the creator's Instagram and YouTube links, added or changed at any time. */
export function ChannelsForm({ overview: o }: { overview: Overview }) {
  const queryClient = useQueryClient();
  const [instagram, setInstagram] = useState(o.profile_url ?? "");
  const [youtube, setYoutube] = useState(o.youtube_url ?? "");
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.PATCH("/creators/me", { body: { instagram_url: instagram.trim(), youtube_url: youtube.trim() } })),
    onSuccess: async (me) => {
      // Show them as we keep them (a bare @handle becomes a full link).
      setInstagram(me.profile_url ?? "");
      setYoutube(me.youtube_url ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["creator-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["creator-me"] }),
      ]);
    },
  });
  const changed = instagram.trim() !== (o.profile_url ?? "") || youtube.trim() !== (o.youtube_url ?? "");

  return (
    <Card>
      <CardHeader title="Your channels" description="Where travellers can find you. Paste a link or your @handle." />
      <form
        className="flex flex-col gap-4 px-5 pb-5 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) save.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Instagram
          <input
            value={instagram}
            maxLength={300}
            inputMode="url"
            placeholder="instagram.com/yourname or @yourname"
            onChange={(e) => setInstagram(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          YouTube
          <input
            value={youtube}
            maxLength={300}
            inputMode="url"
            placeholder="youtube.com/@yourchannel or @yourchannel"
            onChange={(e) => setYoutube(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!changed || save.isPending}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : saved ? "Saved" : "Save channels"}
          </button>
          <span className="text-xs text-muted">Leave one empty to remove it.</span>
        </div>
        {save.error && <p className="m-0 text-[13px] text-danger">{errorMessage(save.error)}</p>}
      </form>
    </Card>
  );
}
