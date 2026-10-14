"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { postJson } from "@/lib/session";

import { IMG, LINKS } from "../data";

const FIELD =
  "rounded-[12px] border-[1.5px] border-[#E3DCD2] bg-white px-3.5 py-3 text-[15px] text-[#0D2436] outline-none focus:border-[#0A7C80]";
const LABEL = "flex flex-col gap-1.5 text-[13px] font-semibold text-[#3F5A72]";

type Who = "traveler" | "creator";

/** The B4-styled sign in / sign up, with a traveller (email + password) and a creator
 *  (email + 4-digit code) path. Labels match what the rest of the app and tests expect. */
export function B4Auth({ mode }: { mode: "login" | "signup" }) {
  const [who, setWho] = useState<Who>("traveler");
  return (
    <div className="b4-auth flex min-h-dvh flex-col bg-[#FBF8F4] px-4 py-8">
      <Link href={LINKS.home} aria-label="wishtrip home" className="mx-auto mb-8 flex">
        <Image src={IMG.logo} alt="wishtrip" width={138} height={38} priority className="h-[34px] w-auto" />
      </Link>
      <div className="mx-auto w-full max-w-[420px]">
        <div role="tablist" aria-label="Account type" className="mb-6 grid grid-cols-2 gap-1 rounded-full border border-[#E8E1D8] bg-[#F1EAE0] p-1">
          {([["traveler", "I'm a traveller"], ["creator", "I'm a creator"]] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={who === id}
              onClick={() => setWho(id)}
              className={`cursor-pointer rounded-full px-3 py-2 text-sm font-semibold transition-colors ${who === id ? "bg-white text-[#0D2436] shadow-sm" : "text-[#8A7F72] hover:text-[#0D2436]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {who === "traveler" ? <TravelerForm mode={mode} /> : <CreatorForm />}
      </div>
    </div>
  );
}

function Shell({ title, sub, children, footer }: { title: string; sub: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <>
      <h1 className="font-display text-[34px] font-medium leading-tight text-[#0D2436]">{title}</h1>
      <p className="mt-1.5 text-[14.5px] text-[#566E85]">{sub}</p>
      <div className="mt-6 flex flex-col gap-4 rounded-[22px] border border-[#E8E1D8] bg-white p-6 shadow-[0_20px_50px_rgba(7,35,56,.07)]">{children}</div>
      {footer && <p className="mt-4 text-center text-sm text-[#566E85]">{footer}</p>}
    </>
  );
}

function Button({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" disabled={disabled} className="cursor-pointer rounded-full bg-[#072338] p-3.5 text-center text-[15px] font-bold text-white disabled:opacity-60">
      {children}
    </button>
  );
}

function Err({ children }: { children: string }) {
  return <p className="rounded-xl bg-[#FBE9E6] px-3 py-2 text-sm font-medium text-[#B8362A]">{children}</p>;
}

function TravelerForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
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
    <Shell
      title={mode === "login" ? "Welcome back" : "Start planning"}
      sub={mode === "login" ? "Sign in to your trips." : "Create a free account to plan and save trips."}
      footer={
        mode === "login" ? (
          <>New here? <Link href={LINKS.createAccount} className="font-semibold text-[#0A7C80]">Create an account</Link></>
        ) : (
          <>Already have an account? <Link href={LINKS.signIn} className="font-semibold text-[#0A7C80]">Sign in</Link></>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === "signup" && (
          <label className={LABEL}>Your name<input name="full_name" autoComplete="name" className={FIELD} /></label>
        )}
        <label className={LABEL}>Email<input name="email" type="email" autoComplete="username" required className={FIELD} /></label>
        <label className={LABEL}>
          Password
          <input name="password" type="password" minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} required className={FIELD} />
          {mode === "signup" && <span className="text-xs font-normal text-[#8A7F72]">At least 8 characters.</span>}
        </label>
        {error && <Err>{error}</Err>}
        <Button disabled={busy}>{busy ? "Just a moment…" : mode === "login" ? "Sign in" : "Create account"}</Button>
      </form>
    </Shell>
  );
}

function CreatorForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
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
  async function verify(e: React.FormEvent) {
    e.preventDefault();
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
    <Shell title="Creator sign in" sub="Share the trips behind your reels and earn when travellers you bring plan a trip.">
      {step === "email" ? (
        <form onSubmit={send} className="flex flex-col gap-4">
          <label className={LABEL}>
            Email
            <input name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
            <span className="text-xs font-normal text-[#8A7F72]">We&rsquo;ll email you a 4-digit code to sign in. No password needed.</span>
          </label>
          {error && <Err>{error}</Err>}
          <Button disabled={busy}>{busy ? "Sending…" : "Email me a code"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-sm text-[#566E85]">We sent a 4-digit code to <span className="font-semibold text-[#0D2436]">{email}</span>.</p>
          <label className={LABEL}>
            4-digit code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} className={FIELD} />
            <span className="text-xs font-normal text-[#8A7F72]">Demo: there&rsquo;s no email yet, so enter 1234.</span>
          </label>
          {error && <Err>{error}</Err>}
          <Button disabled={busy}>{busy ? "Signing in…" : "Verify & continue"}</Button>
          <button type="button" onClick={() => { setStep("email"); setCode(""); setError(null); }} className="text-center text-sm text-[#8A7F72] hover:text-[#0D2436]">
            Use a different email
          </button>
        </form>
      )}
    </Shell>
  );
}
