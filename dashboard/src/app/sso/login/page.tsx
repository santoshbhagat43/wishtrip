"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { errorMessage } from "@/lib/api/client";

type Mode = "signin" | "signup";

const ERRORS: Record<string, string> = {
  google_denied: "Google sign-in was cancelled.",
  google_state: "Google sign-in expired. Please try again.",
  google_exchange: "We couldn't complete Google sign-in. Please try again.",
  invalid: "Invalid email or password",
  email_taken: "An account with that email already exists. Sign in instead.",
  signup_invalid: "Check your details: a valid email and a password of at least 8 characters.",
};

const INPUT =
  "h-[52px] rounded-2xl border-[1.5px] border-border bg-surface px-[18px] text-[15px] outline-none focus:border-brand";

function SsoPanel() {
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "";
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [error, setError] = useState<string | null>(ERRORS[params.get("error") ?? ""] ?? null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch(signup ? "/api/sso/register" : "/api/sso/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        full_name: form.get("full_name") ?? undefined,
        email: form.get("email"),
        password: form.get("password"),
        redirect,
      }),
    });
    if (res.ok) {
      const { redirect: dest } = (await res.json()) as { redirect: string };
      // Full navigation so the destination subdomain reads the shared session cookie.
      window.location.href = dest;
    } else {
      setError(errorMessage(await res.json().catch(() => ({}))));
      setBusy(false);
    }
  }

  const googleHref = `/api/sso/google/start${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted">WishTrip account</p>
        <h1 className="text-[40px] leading-[1.08]">{signup ? "Create your account" : "Sign in"}</h1>
        <p className="text-[15px] leading-normal text-muted">
          One account for WishTrip — planning trips and the creator portal.
        </p>
      </div>

      <div role="tablist" aria-label="Sign in or create an account" className="flex gap-1 rounded-full bg-surface-2 p-1">
        {(
          [
            ["signin", "Sign in"],
            ["signup", "Create account"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={`h-[42px] flex-1 rounded-full text-sm font-bold transition-colors ${
              mode === value ? "bg-surface text-brand shadow-card" : "text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <a
          href={googleHref}
          className="flex h-[52px] items-center justify-center gap-2.5 rounded-full border-[1.5px] border-border bg-surface text-[15px] font-semibold transition-colors hover:border-brand"
        >
          <GoogleMark />
          Continue with Google
        </a>

        <div className="flex items-center gap-3 text-[12px] text-muted">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        {/* A real POST target: if the form is submitted before the page hydrates, the browser posts
            it to the API instead of doing a GET that would put the password in the URL. */}
        <form
          key={mode}
          onSubmit={submit}
          method="post"
          action={signup ? "/api/sso/register" : "/api/sso/login"}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="redirect" value={redirect} />
          {signup && (
            <div className="flex flex-col gap-2">
              <label htmlFor="full_name" className="text-sm font-semibold">
                Your name
              </label>
              <input id="full_name" name="full_name" autoComplete="name" required className={INPUT} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-semibold">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete={signup ? "email" : "username"}
              required
              autoFocus={!signup}
              placeholder="you@example.com"
              className={INPUT}
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
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={signup ? 8 : undefined}
              className={INPUT}
            />
            {signup && <p className="text-[12.5px] text-muted">At least 8 characters.</p>}
          </div>

          {error && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="flex h-[52px] items-center justify-center gap-2.5 rounded-full bg-brand text-[15px] font-bold text-on-brand shadow-raised transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {busy ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
            {!busy && <ArrowRight className="size-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

export default function SsoLoginPage() {
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
        <div className="w-full max-w-[420px]">
          <Suspense fallback={<div className="h-[420px] animate-pulse rounded-2xl bg-surface-2" />}>
            <SsoPanel />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
