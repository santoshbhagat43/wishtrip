"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { postJson } from "@/lib/session";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await postJson(mode === "login" ? "/api/auth/login" : "/api/auth/register", Object.fromEntries(form));
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      router.replace(next?.startsWith("/") ? next : mode === "signup" ? "/profile?welcome=1" : "/plan");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col px-4 py-14">
      <h1 className="text-[32px] leading-tight">{mode === "login" ? "Welcome back" : "Start planning"}</h1>
      <p className="mt-1 text-sm text-muted">
        {mode === "login" ? "Sign in to your trips." : "Create a free account to plan and save trips."}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-6 shadow-card">
        {mode === "signup" && (
          <Field label="Your name"><Input name="full_name" autoComplete="name" /></Field>
        )}
        <Field label="Email"><Input name="email" type="email" autoComplete="username" required /></Field>
        <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
          <Input name="password" type="password" minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
        </Field>
        {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Just a moment…" : mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {mode === "login" ? <>New here? <Link href="/signup" className="font-semibold text-brand">Create an account</Link></> : <>Already have an account? <Link href="/login" className="font-semibold text-brand">Sign in</Link></>}
      </p>
    </div>
  );
}
