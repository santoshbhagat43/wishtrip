"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ActingProvider } from "@/components/creator-reels/acting";
import { ReelsCard } from "@/components/creator-reels/reels-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { CREATOR_STATUS, referralLink, rupees } from "@/lib/creators";
import { relativeTime, titleCase } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import { useMe } from "@/lib/hooks/use-me";

type Creator = Schemas["CreatorDetail"];
type Status = Creator["status"];

const EVENT_LABEL: Record<string, string> = {
  visit: "Opened the creator's link",
  signup: "Signed up through the link",
  reel_import: "Pasted a reel",
  trip_planned: "Planned a trip",
  booking: "Booked",
};

export default function CreatorPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const creator = useQuery({
    queryKey: ["creator", id],
    queryFn: async () => unwrap(await api.GET("/creators/{creator_id}", { params: { path: { creator_id: id } } })),
  });

  if (creator.isLoading) return <Spinner />;
  if (creator.error || !creator.data) return <ErrorNote error={creator.error} />;
  const c = creator.data;
  const refresh = (data: Creator) => {
    queryClient.setQueryData(["creator", id], data);
    queryClient.invalidateQueries({ queryKey: ["creators"] });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb="Creators"
        title={c.handle ? `@${c.handle}` : c.email ?? "New creator"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={CREATOR_STATUS[c.status].tone}>{CREATOR_STATUS[c.status].label}</Badge>
            {c.email && <span>{c.email}</span>}
            {c.display_name && <span>{c.display_name}</span>}
            {c.handle && c.profile_url && (
              <a href={c.profile_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                Instagram profile ↗
              </a>
            )}
            {c.youtube_url && (
              <a href={c.youtube_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                YouTube channel ↗
              </a>
            )}
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border sm:grid-cols-4">
              {(
                [
                  ["Reel pastes", c.stats.reel_imports],
                  ["Travellers brought in", c.stats.credited_travellers],
                  ["Trips planned", c.stats.trips_planned],
                  ["Earned", rupees(c.stats.earned_paise)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="bg-surface p-4">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          </Card>

          <Onboarding creator={c} onChange={refresh} />
          <DeleteCreator creator={c} />

          <ActingProvider creatorId={id}>
            <ReelsCard
              approved={c.status === "active"}
              title="Reel links and itineraries"
              description={`Add reels for ${c.display_name || (c.handle ? `@${c.handle}` : "this creator")} the way they would. What you add appears in their own dashboard, and is recorded as done by staff.`}
            />
          </ActingProvider>

          <Card>
            <CardHeader title="Reels travellers pasted" description="What we read from each reel travellers pasted." />
            {c.reels.length === 0 ? (
              <Empty title="No reels yet" />
            ) : (
              <ul className="divide-y divide-border">
                {c.reels.map((r) => (
                  <li key={r.shortcode}>
                    <Link href={`/creators/${id}/reels/${r.shortcode}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
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
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Commissions creator={c} onChange={refresh} />

          <Card>
            <CardHeader title="Activity" description="The latest 100 touches between travellers and this creator." />
            {c.activity.length === 0 ? (
              <Empty title="No activity yet" />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {c.activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>
                      {EVENT_LABEL[a.event]}
                      <span className="text-muted"> · {a.user_email ?? "anonymous visitor"}</span>
                    </span>
                    <span className="whitespace-nowrap text-muted">{relativeTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Settings key={c.id} creator={c} onChange={refresh} />
      </div>
    </div>
  );
}

const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Where this creator is in onboarding, and the buttons that move it on. Each one sends the
 *  creator the matching email. */
/** Admins only: remove a creator and their account entirely, so a test email can apply again. */
function DeleteCreator({ creator }: { creator: Creator }) {
  const { data: me } = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE("/creators/{creator_id}", { params: { path: { creator_id: creator.id } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["creators"] });
      router.push("/creators");
    },
  });
  if (me?.role !== "admin") return null;
  return (
    <Card>
      <CardHeader
        title="Delete this creator"
        description="Removes the creator, their trips, reels and links, and their sign-in account, so the same email can apply again from the start. It can't be undone."
      />
      <div className="flex flex-wrap items-center gap-3 px-5 pb-5">
        {asking ? (
          <>
            <span className="text-sm">Delete {creator.email ?? creator.handle ?? "this creator"} for good?</span>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Deleting…" : "Yes, delete"}
            </Button>
            <Button variant="secondary" disabled={remove.isPending} onClick={() => setAsking(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setAsking(true)}>
            Delete creator
          </Button>
        )}
        <ErrorNote error={remove.error} />
      </div>
    </Card>
  );
}

function Onboarding({ creator, onChange }: { creator: Creator; onChange: (c: Creator) => void }) {
  const { onboarding: o } = creator;
  const [revealed, setRevealed] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: async (status: "active" | "rejected") =>
      unwrap(
        await api.PATCH("/creators/{creator_id}", { params: { path: { creator_id: creator.id } }, body: { status } }),
      ),
    onSuccess: onChange,
  });
  const remind = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/creators/{creator_id}/bank-details/remind", { params: { path: { creator_id: creator.id } } })),
    onSuccess: onChange,
  });
  const confirm = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/creators/{creator_id}/bank-details/confirm", { params: { path: { creator_id: creator.id } } })),
    onSuccess: onChange,
  });
  const reveal = useMutation({
    mutationFn: async () =>
      unwrap(await api.GET("/creators/{creator_id}/bank-details", { params: { path: { creator_id: creator.id } } })),
    onSuccess: (d) => setRevealed(d.account_number),
  });

  const undecided = ["pending", "unclaimed", "invited", "rejected"].includes(creator.status);
  const approved = creator.status === "active" || creator.status === "paused";
  const bank = o.bank;
  const noEmail = !creator.email;
  const steps: [string, string | null][] = [
    ["Applied", creator.created_at],
    ["Approved", o.approved_at ?? null],
    ["Bank details sent", bank.submitted_at ?? null],
    ["Account active", bank.confirmed_at ?? null],
  ];

  return (
    <Card>
      <CardHeader title="Onboarding" description="Each button below sends the creator the matching email." />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map(([label, at]) => (
            <li key={label} className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
              <span className={`block font-semibold ${at ? "text-ok" : "text-muted"}`}>{at ? "✓ " : ""}{label}</span>
              <span className="text-xs text-muted">{at ? dateOf(at) : "Not yet"}</span>
            </li>
          ))}
        </ol>
        {creator.status === "rejected" && o.rejected_at && (
          <p className="m-0 text-sm text-muted">Rejected on {dateOf(o.rejected_at)}. They can apply again after the cool-off.</p>
        )}
        {noEmail && <p className="m-0 text-sm text-warn">This creator has no email address, so no emails can be sent.</p>}

        {undecided && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={decide.isPending || noEmail} onClick={() => decide.mutate("active")}>
              Approve and send the welcome email
            </Button>
            {creator.status !== "rejected" && (
              <Button
                variant="secondary"
                disabled={decide.isPending || noEmail}
                onClick={() => window.confirm("Reject this application and email the creator?") && decide.mutate("rejected")}
              >
                Reject and send the update email
              </Button>
            )}
          </div>
        )}

        {approved && !bank.confirmed_at && (
          <div className="flex flex-col gap-3">
            {!bank.submitted ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" disabled={remind.isPending || noEmail} onClick={() => remind.mutate()}>
                  {remind.isPending ? "Sending…" : "Send bank details reminder"}
                </Button>
                <span className="text-sm text-muted">
                  {o.bank_reminder_sent_at ? `Last reminded ${dateOf(o.bank_reminder_sent_at)}.` : "No reminder sent yet."}
                </span>
              </div>
            ) : (
              <p className="m-0 text-sm text-muted">Sent on {dateOf(bank.submitted_at!)}. Check them, then confirm.</p>
            )}
          </div>
        )}

        {bank.submitted && (
          <dl className="m-0 grid gap-3 rounded-xl border border-border p-4 text-sm sm:grid-cols-2">
            {(
              [
                ["Account holder", bank.holder],
                ["Bank", bank.bank_name],
                ["IFSC", bank.ifsc],
                ["UPI", bank.upi || "—"],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="m-0 font-medium">{value}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted">Account number</dt>
              <dd className="m-0 flex items-center gap-3 font-medium tabular-nums">
                {revealed ?? `•••• •••• ${bank.account_last4}`}
                {!revealed && (
                  <Button size="sm" variant="secondary" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
                    Show full number
                  </Button>
                )}
              </dd>
            </div>
          </dl>
        )}
        {approved && bank.submitted && !bank.confirmed_at && (
          <div>
            <Button variant="accent" disabled={confirm.isPending || noEmail} onClick={() => confirm.mutate()}>
              {confirm.isPending ? "Confirming…" : "Confirm bank details and activate the account"}
            </Button>
          </div>
        )}
        {bank.confirmed_at && <p className="m-0 text-sm text-ok">Bank details confirmed on {dateOf(bank.confirmed_at)}. The account is active.</p>}
        <ErrorNote error={decide.error ?? remind.error ?? confirm.error ?? reveal.error} />
      </div>
    </Card>
  );
}

function Settings({ creator, onChange }: { creator: Creator; onChange: (c: Creator) => void }) {
  const [status, setStatus] = useState<Status>(creator.status);
  const [handle, setHandle] = useState(creator.handle ?? "");
  const [commissionType, setCommissionType] = useState(creator.commission_type);
  const [commissionValue, setCommissionValue] = useState(
    creator.commission_type === "percent"
      ? String(creator.commission_value / 100)
      : String(creator.commission_value / 100),
  );
  const [notes, setNotes] = useState(creator.notes);
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH("/creators/{creator_id}", {
          params: { path: { creator_id: creator.id } },
          body: {
            status,
            notes,
            handle: handle.trim() || null,
            commission_type: commissionType,
            commission_value:
              commissionType === "none" ? 0 : Math.round(Number(commissionValue || 0) * 100),
          },
        }),
      ),
    onSuccess: onChange,
  });
  const link = referralLink(creator.referral_code);

  return (
    <Card className="h-fit">
      <CardHeader title="Affiliate" />
      <form
        className="flex flex-col gap-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Referral link" hint="Travellers who sign up through this link are credited to this creator for 30 days.">
          <span className="flex gap-2">
            <Input readOnly value={link} className="min-w-0 flex-1" />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                copyText(link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </span>
        </Field>
        <Field label="Instagram handle" hint="Set this for a creator who signed up by email, so reels and their link line up.">
          <Input value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))} placeholder="goadiaries" />
        </Field>
        <Field label="Status" hint="Approving or rejecting here also sends the creator the matching email. Only an affiliate who accepted the terms is owed commission.">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {Object.entries(CREATOR_STATUS).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Commission on bookings" hint="What this creator earns when a traveller books through their affiliate link. Takes effect once bookings are live.">
          <Select value={commissionType} onChange={(e) => setCommissionType(e.target.value as typeof commissionType)}>
            <option value="none">None yet</option>
            <option value="percent">Percentage of each booking</option>
            <option value="flat">Flat amount per booking</option>
          </Select>
        </Field>
        {commissionType !== "none" && (
          <Field label={commissionType === "percent" ? "Percentage (%)" : "Amount per booking (₹)"}>
            <Input
              type="number"
              min={0}
              step={commissionType === "percent" ? "0.5" : "1"}
              max={commissionType === "percent" ? 100 : undefined}
              inputMode="decimal"
              value={commissionValue}
              onChange={(e) => setCommissionValue(e.target.value)}
            />
          </Field>
        )}
        <Field label="Notes">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorNote error={save.error} />
        <Button type="submit" variant="accent" disabled={save.isPending}>
          {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : "Save"}
        </Button>
      </form>
    </Card>
  );
}

function Commissions({ creator, onChange }: { creator: Creator; onChange: (c: Creator) => void }) {
  const update = useMutation({
    mutationFn: async ({ entry, status }: { entry: string; status: "approved" | "paid" | "void" }) =>
      unwrap(
        await api.PATCH("/creators/{creator_id}/commissions/{entry_id}", {
          params: { path: { creator_id: creator.id, entry_id: entry } },
          body: { status },
        }),
      ),
    onSuccess: onChange,
  });
  return (
    <Card>
      <CardHeader title="Commissions" description={`${rupees(creator.stats.paid_paise)} paid of ${rupees(creator.stats.earned_paise)} earned.`} />
      {creator.commissions.length === 0 ? (
        <Empty title="Nothing earned yet">A commission is booked when a traveller this creator brought in plans their first trip.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Traveller</Th>
              <Th>For</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {creator.commissions.map((e) => (
              <tr key={e.id}>
                <Td>{e.user_email ?? "—"}</Td>
                <Td className="text-muted">{titleCase(e.event.replace("_", " "))}</Td>
                <Td className="text-right tabular-nums">{rupees(e.amount_paise)}</Td>
                <Td>
                  <Badge tone={e.status === "paid" ? "ok" : e.status === "void" ? "neutral" : e.status === "approved" ? "info" : "warn"}>
                    {titleCase(e.status)}
                  </Badge>
                </Td>
                <Td className="text-right">
                  {e.status === "pending" && (
                    <Button size="sm" variant="secondary" onClick={() => update.mutate({ entry: e.id, status: "approved" })}>
                      Approve
                    </Button>
                  )}
                  {e.status === "approved" && (
                    <Button size="sm" variant="secondary" onClick={() => update.mutate({ entry: e.id, status: "paid" })}>
                      Mark paid
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
