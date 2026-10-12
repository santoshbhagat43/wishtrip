"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { errorMessage } from "@/lib/api/client";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    if (res.ok) {
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } else {
      setError(errorMessage(await res.json().catch(() => ({}))));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-semibold">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@wishtrip.co"
          className="h-[52px] rounded-2xl border-[1.5px] border-border bg-surface px-[18px] text-[15px] outline-none focus:border-brand"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-semibold">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-[52px] rounded-2xl border-[1.5px] border-border bg-surface px-[18px] text-[15px] outline-none focus:border-brand"
        />
      </div>

      {error && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="flex h-[52px] items-center justify-center gap-2.5 rounded-full bg-brand text-[15px] font-bold text-on-brand shadow-raised transition-colors hover:bg-brand-strong disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in"}
        {!busy && <ArrowRight className="size-4" />}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-wrap gap-5 bg-bg p-5">
      <section
        aria-label="WishTrip — Travel your way"
        className="flex min-h-[300px] flex-[1_1_560px] flex-col items-center justify-center rounded-[28px] border border-border bg-surface p-12 shadow-card"
      >
        <Image
          src="/logo.png"
          alt="WishTrip — Travel your way"
          width={909}
          height={351}
          priority
          className="w-[min(300px,70%)] dark:brightness-0 dark:invert"
        />
      </section>

      <main className="flex flex-[1_1_440px] items-center justify-center px-4 py-8">
        <div className="flex w-full max-w-[420px] flex-col gap-7">
          <div className="flex flex-col gap-2.5">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted">Admin &amp; CMS</p>
            <h1 className="text-[40px] leading-[1.08]">Sign in</h1>
            <p className="text-[15px] leading-normal text-muted">
              For the WishTrip team. Your account is created by an admin — there is no public sign-up here.
            </p>
          </div>

          <Suspense fallback={<div className="h-[52px] animate-pulse rounded-2xl bg-surface-2" />}>
            <LoginForm />
          </Suspense>

          <p className="text-[12.5px] leading-normal text-muted">
            Access is role-based, and every sign-in and change is audit-logged. Google sign-in and one-time email links
            are designed but not built yet.
          </p>
        </div>
      </main>
    </div>
  );
}
