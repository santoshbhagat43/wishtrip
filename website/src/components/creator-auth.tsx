"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { postJson } from "@/lib/session";

/** Creator sign-in: email → a 4-digit code → signed in (new creators land as "waiting for approval"). */
export function CreatorAuth() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/auth/creator/request-otp", { email });
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the code");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/auth/creator/verify", { email, code });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      router.replace("/creator");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't work");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col">
      <h1 className="text-[32px] leading-tight">Creator sign in</h1>
      <p className="mt-1 text-sm text-muted">
        Share the trips behind your reels and earn when travellers you bring plan a trip.
      </p>

      {step === "email" ? (
        <form onSubmit={sendCode} className="mt-6 flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-6 shadow-card">
          <Field label="Email" hint="We'll email you a 4-digit code to sign in. No password needed.">
            <Input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Sending…" : "Email me a code"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-6 flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-6 shadow-card">
          <p className="text-sm text-muted">We sent a 4-digit code to <span className="font-semibold text-text">{email}</span>.</p>
          <Field label="4-digit code" hint="Demo: there's no email yet, so enter 1234.">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Signing in…" : "Verify & continue"}</Button>
          <button type="button" onClick={() => { setStep("email"); setCode(""); setError(null); }} className="text-center text-sm text-muted hover:text-text">
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
