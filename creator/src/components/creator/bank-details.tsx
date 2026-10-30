"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Card, CardHeader } from "@/components/ui/card";
import { api, errorMessage, unwrap } from "@/lib/api/client";

const input =
  "rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[14.5px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** "Bank details": where WishTrip pays the creator's earnings. Sent once approved; the WishTrip
 *  team confirms them, which makes the account active. The full account number is never shown
 *  back: only its last four digits. */
export function BankDetails({ approved }: { approved: boolean }) {
  const queryClient = useQueryClient();
  const saved = useQuery({
    queryKey: ["creator-bank"],
    enabled: approved,
    queryFn: async () => unwrap(await api.GET("/creators/me/bank-details")),
  });
  const d = saved.data;
  const [form, setForm] = useState({ holder: "", bank_name: "", ifsc: "", account_number: "", upi: "" });
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT("/creators/me/bank-details", { body: form })),
    onSuccess: async () => {
      setEditing(false);
      setDone(true);
      setForm({ ...form, account_number: "" });
      await queryClient.invalidateQueries({ queryKey: ["creator-bank"] });
    },
  });

  const edit = () => {
    setForm({ holder: d?.holder ?? "", bank_name: d?.bank_name ?? "", ifsc: d?.ifsc ?? "", account_number: "", upi: d?.upi ?? "" });
    setDone(false);
    setEditing(true);
  };
  const showForm = approved && !!d && (!d.submitted || editing);

  return (
    <div id="bank-details" className="scroll-mt-24">
    <Card>
      <CardHeader
        title="Bank details"
        description="Where we pay your earnings. They unlock trip links on your dashboard once the WishTrip team has checked them."
      />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-4 text-sm">
        {!approved && <p className="m-0 text-muted">You can add them as soon as your application is approved.</p>}

        {approved && d?.submitted && !editing && (
          <>
            <dl className="m-0 grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["Account holder", d.holder],
                  ["Bank", d.bank_name],
                  ["IFSC", d.ifsc],
                  ["Account number", `•••• ${d.account_last4}`],
                  ["UPI", d.upi || "Not added"],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="m-0 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 text-muted" data-testid="bank-status">
              {d.confirmed_at
                ? `Confirmed on ${when(d.confirmed_at)}. Your account is active.`
                : `Sent on ${when(d.submitted_at!)}. The WishTrip team will confirm them shortly.`}
            </p>
            {done && <p className="m-0 text-ok">Saved. Thank you.</p>}
            <div>
              <button type="button" onClick={edit} className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2">
                Change bank details
              </button>
            </div>
          </>
        )}

        {showForm && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Account holder name
                <input required minLength={2} value={form.holder} onChange={set("holder")} className={input} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Bank name
                <input required minLength={2} value={form.bank_name} onChange={set("bank_name")} className={input} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                IFSC code
                <input required minLength={11} maxLength={11} value={form.ifsc} onChange={set("ifsc")} placeholder="HDFC0001234" className={`${input} uppercase`} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Account number
                <input required inputMode="numeric" value={form.account_number} onChange={set("account_number")} className={input} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold sm:col-span-2">
                UPI id (optional)
                <input value={form.upi} onChange={set("upi")} placeholder="name@bank" className={input} autoComplete="off" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={save.isPending}
                className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Send bank details"}
              </button>
              {editing && (
                <button type="button" onClick={() => setEditing(false)} className="text-sm font-semibold text-muted hover:text-text">
                  Cancel
                </button>
              )}
            </div>
            <p className="m-0 text-xs text-muted">We keep your account number encrypted, and only show its last four digits.</p>
            {save.error && <p role="alert" className="m-0 text-[13px] text-danger">{errorMessage(save.error)}</p>}
          </form>
        )}
      </div>
    </Card>
    </div>
  );
}
