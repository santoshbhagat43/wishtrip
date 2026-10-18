"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ReelLinks } from "@/components/creator/reel-links";
import { TripTools } from "@/components/creator/trip-tools";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty, ErrorNote, Spinner } from "@/components/ui/card";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { overallLink, rupees, withoutScheme } from "@/lib/creator";
import { relativeTime, titleCase } from "@/lib/format";
import { useMe } from "@/lib/session";

type Overview = Schemas["CreatorOverview"];

const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Approved creator", tone: "ok" },
  pending: { label: "Waiting for approval", tone: "warn" },
  paused: { label: "Paused", tone: "danger" },
  unclaimed: { label: "Not yet claimed", tone: "neutral" },
};

const EVENT_LABEL: Record<string, string> = {
  visit: "Someone opened your link",
  signup: "A traveller signed up through your link",
  reel_import: "A traveller pasted one of your reels",
  trip_planned: "A traveller you brought in planned a trip",
  booking: "A traveller you brought in booked",
};

function deal(o: Overview) {
  if (o.commission_type === "percent") return `${o.commission_value / 100}% of every booking`;
  if (o.commission_type === "flat") return `${rupees(o.commission_value)} per booking`;
  return "Not set yet — the WishTrip team agrees this with you";
}

/** The creator's dashboard on creator.<domain>: their numbers, reels, earnings and link. */
export default function CreatorDashboardPage() {
  const me = useMe();
  const overview = useQuery({
    queryKey: ["creator-overview"],
    enabled: me.data?.role === "creator",
    retry: false,
    queryFn: async () => unwrap(await api.GET("/creators/me/overview")),
  });

  if (me.isLoading || (me.data?.role === "creator" && overview.isLoading)) return <Spinner />;

  if (!me.data) {
    return (
      <Notice title="Creator sign-in" body="Sign in to see your creator dashboard.">
        <Link href="/creators/join">
          <Button>Sign in</Button>
        </Link>
      </Notice>
    );
  }
  if (me.data.role !== "creator") {
    return (
      <Notice title="This is the creator dashboard" body="You're signed in with a traveller account.">
        <Link href="/creators">
          <Button variant="secondary">About the creator programme</Button>
        </Link>
      </Notice>
    );
  }
  if (overview.error || !overview.data) return <ErrorNote error={overview.error ?? "Couldn't load your dashboard."} />;

  const o = overview.data;
  const status = STATUS[o.status] ?? STATUS.pending;
  const name = o.display_name || (o.handle ? `@${o.handle}` : (o.email ?? "Your creator account"));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-[34px] leading-[1.08]">{name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={status.tone}>{status.label}</Badge>
          {o.email && <span>{o.email}</span>}
          {o.handle && o.profile_url && (
            <a href={o.profile_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              Instagram profile ↗
            </a>
          )}
          {o.youtube_url && (
            <a href={o.youtube_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              YouTube channel ↗
            </a>
          )}
          <span>· creator since {new Date(o.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</span>
        </p>
      </div>

      {o.status === "pending" && (
        <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Your account is waiting for the WishTrip team to approve it. We&rsquo;ll email you the moment you&rsquo;re in.
        </p>
      )}
      {o.status === "paused" && (
        <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          Your creator account is paused. Reach out to the WishTrip team to get it active again.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border sm:grid-cols-4">
              {(
                [
                  ["Reel pastes", o.stats.reel_imports],
                  ["Travellers brought in", o.stats.credited_travellers],
                  ["Trips planned", o.stats.trips_planned],
                  ["Earned", rupees(o.stats.earned_paise)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="bg-surface p-4">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          </Card>

          <ReelLinks approved={o.status === "active"} />

          {o.status === "active" && (
            <Card>
              <CardHeader title="Your trips" description="Turn a reel into a trip travellers can follow and book." />
              <div className="px-5 pb-5">
                <TripTools />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Reels" description="Your reels that travellers pasted into WishTrip, and what we read from each." />
            {o.reels.length === 0 ? (
              <Empty title="No reels yet">When a traveller pastes one of your reels, it shows up here.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {o.reels.map((r) => (
                  <li key={r.shortcode}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60"
                    >
                      {r.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- backend media
                        <img src={r.thumbnail_url} alt="" className="h-16 w-10 flex-none rounded-lg object-cover" />
                      ) : (
                        <span className="h-16 w-10 flex-none rounded-lg bg-surface-2" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{r.destination_name || "Unknown destination"}</span>
                        <span className="block truncate text-sm text-muted">{r.summary}</span>
                      </span>
                      <span className="text-right text-sm text-muted">
                        <span className="block tabular-nums">
                          {r.verified_places}/{r.places} places checked
                        </span>
                        <span className="block tabular-nums">{r.imports} pastes</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Commissions"
              description={`${rupees(o.stats.paid_paise)} paid of ${rupees(o.stats.earned_paise)} earned.`}
            />
            {o.commissions.length === 0 ? (
              <Empty title="Nothing earned yet">You earn when a traveller you brought in books through your link.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted">
                      <th className="border-b border-border px-5 py-2.5 font-medium">Date</th>
                      <th className="border-b border-border px-5 py-2.5 font-medium">For</th>
                      <th className="border-b border-border px-5 py-2.5 text-right font-medium">Amount</th>
                      <th className="border-b border-border px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.commissions.map((e) => (
                      <tr key={e.id}>
                        <td className="border-b border-border px-5 py-3 text-muted">{relativeTime(e.created_at)}</td>
                        <td className="border-b border-border px-5 py-3">{titleCase(e.event.replace("_", " "))}</td>
                        <td className="border-b border-border px-5 py-3 text-right tabular-nums">{rupees(e.amount_paise)}</td>
                        <td className="border-b border-border px-5 py-3">
                          <Badge
                            tone={e.status === "paid" ? "ok" : e.status === "void" ? "neutral" : e.status === "approved" ? "info" : "warn"}
                          >
                            {titleCase(e.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity" description="The latest touches between travellers and your link." />
            {o.activity.length === 0 ? (
              <Empty title="No activity yet">Share your link to get started.</Empty>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {o.activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>{EVENT_LABEL[a.event] ?? titleCase(a.event)}</span>
                    <span className="whitespace-nowrap text-muted">{relativeTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Affiliate overview={o} />
      </div>
    </div>
  );
}

/** The creator's link and deal. Read-only: the WishTrip team sets the terms. */
function Affiliate({ overview: o }: { overview: Overview }) {
  const [copied, setCopied] = useState(false);
  const link = overallLink(o.referral_code);

  return (
    <Card className="h-fit">
      <CardHeader title="Affiliate" />
      <div className="flex flex-col gap-5 px-5 pb-5 pt-4 text-sm">
        <div className="flex flex-col gap-2">
          <span className="font-semibold">Your overall link</span>
          <code
            aria-label="Your overall referral link"
            className="break-all rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-snug"
          >
            {withoutScheme(link)}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <span className="text-xs text-muted">
            Works anywhere. For a single reel, make a reel link above, so you can see which one is working.
            Travellers who sign up through either are credited to you for 30 days.
          </span>
        </div>

        <dl className="flex flex-col gap-3">
          {(
            [
              ["Your deal", deal(o)],
              ["Instagram", o.handle ? `@${o.handle}` : "Not added"],
              ["YouTube", o.youtube_url ? o.youtube_url.replace(/^https:\/\/www\.youtube\.com\//, "") : "Not added"],
              ["Status", (STATUS[o.status] ?? STATUS.pending).label],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-muted">Need something changed? Contact the WishTrip team.</p>
      </div>
    </Card>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-[28px] leading-tight">{title}</h1>
      <p className="mt-2 text-muted">{body}</p>
      <div className="mt-5 flex justify-center">{children}</div>
    </div>
  );
}
