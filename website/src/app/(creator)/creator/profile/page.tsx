"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { ChannelsForm } from "@/components/creator/channels-form";
import { PageProfile } from "@/components/creator/page-profile";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote, Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";
import { useMe } from "@/lib/session";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Approved creator", tone: "ok" },
  pending: { label: "Waiting for approval", tone: "warn" },
  paused: { label: "Paused", tone: "danger" },
  unclaimed: { label: "Not yet claimed", tone: "neutral" },
  invited: { label: "Invited", tone: "neutral" },
};

/** The creator's profile (creator.<domain>/profile): the photos and name on their public page,
 *  and the account details staff manage. */
export default function CreatorProfilePage() {
  const me = useMe();
  const overview = useQuery({
    queryKey: ["creator-overview"],
    enabled: me.data?.role === "creator",
    retry: false,
    queryFn: async () => unwrap(await api.GET("/creators/me/overview")),
  });

  if (me.isLoading || (me.data?.role === "creator" && overview.isLoading)) return <Spinner />;
  if (!me.data || me.data.role !== "creator") {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-[28px] leading-tight">This is the creator profile</h1>
        <p className="mt-2 text-muted">Sign in with your creator account to edit it.</p>
        <div className="mt-5 flex justify-center">
          <Link href="/login">
            <Button>Sign in</Button>
          </Link>
        </div>
      </div>
    );
  }
  if (overview.error || !overview.data) return <ErrorNote error={overview.error ?? "Couldn't load your profile."} />;

  const o = overview.data;
  const status = STATUS[o.status] ?? STATUS.pending;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/" className="w-fit text-sm text-muted hover:text-text">
          ← Dashboard
        </Link>
        <h1 className="font-sans! m-0 text-[30px] font-bold leading-tight tracking-tight">Your profile</h1>
        <p className="m-0 text-sm text-muted">How you appear to travellers on WishTrip.</p>
      </div>

      <PageProfile overview={o} />

      <ChannelsForm overview={o} />

      <Card>
        <CardHeader title="Your account" description="These are managed by the WishTrip team." />
        <dl className="m-0 grid gap-4 px-5 pb-5 pt-4 text-sm sm:grid-cols-2">
          {(
            [
              ["Email", o.email ?? "Not set"],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="m-0 font-medium">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted">Status</dt>
            <dd className="m-0 mt-0.5">
              <Badge tone={status.tone}>{status.label}</Badge>
            </dd>
          </div>
        </dl>
        <p className="m-0 border-t border-border px-5 py-3 text-xs text-muted">Need something changed? Contact the WishTrip team.</p>
      </Card>
    </div>
  );
}
