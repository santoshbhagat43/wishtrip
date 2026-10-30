import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { safeNext } from "@/lib/server/gate";

export const metadata = { title: "Private preview — WishTrip" };

/** Shown while the site is private (SITE_PASSWORD set). A plain form: works without JavaScript. */
export default async function GatePage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto flex max-w-sm flex-col px-4 py-14">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Lock className="size-5" />
      </span>
      <h1 className="mt-4 text-[32px] leading-tight">Private preview</h1>
      <p className="mt-1 text-sm text-muted">WishTrip isn&apos;t public yet. Enter the preview login to continue.</p>
      <form method="post" action="/api/gate" className="mt-6 flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-6 shadow-card">
        <input type="hidden" name="next" value={safeNext(next ?? null)} />
        <Field label="Username"><Input name="username" autoComplete="username" required autoFocus /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">That username and password didn&apos;t match.</p>}
        <Button type="submit" className="w-full">Continue</Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">You&apos;ll stay signed in on this browser for 30 days.</p>
    </div>
  );
}
