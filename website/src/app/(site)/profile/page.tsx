"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { ChipToggle, Field, Select } from "@/components/ui/field";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { COST_LABELS, TIMES } from "@/lib/format";

type Profile = Schemas["ProfileFields"];
const COMPANIONS = [["solo", "Just me"], ["couple", "As a couple"], ["family", "Family with kids"], ["friends", "With friends"], ["seniors", "With parents / seniors"]] as const;
const STYLES = ["relaxed", "adventure", "cultural", "romantic", "foodie", "luxury", "local life"];

function ProfileForm({ initial }: { initial: Profile }) {
  const queryClient = useQueryClient();
  const welcome = useSearchParams().get("welcome");
  const [form, setForm] = useState<Profile>(initial);
  const tags = useQuery({ queryKey: ["tags"], queryFn: async () => unwrap(await api.GET("/explore/tags")) });
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT("/profiles/me", { body: form })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["for-you"] });
    },
  });
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm({ ...form, [k]: v });
  const interests = (tags.data ?? []).filter((t) => t.category === "interest" || t.category === "style");
  return (
    <form
      className="mx-auto max-w-3xl px-4 py-10"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {welcome && <p className="mb-6 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand">Welcome! Tell us how you like to travel — every plan and recommendation uses this.</p>}
      <h1 className="text-[34px] leading-tight">How you travel</h1>
      <p className="mt-1 text-muted">We use this for every recommendation and plan. Change it anytime.</p>
      <div className="mt-8 grid gap-6 rounded-[22px] border border-border bg-surface p-6 shadow-card sm:grid-cols-2">
        <Field label="Usually travelling">
          <Select value={form.companions ?? ""} onChange={(e) => set("companions", (e.target.value || null) as Profile["companions"])}>
            <option value="">Not set</option>
            {COMPANIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Budget">
          <Select value={form.budget_level ?? ""} onChange={(e) => set("budget_level", e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">Not set</option>
            {COST_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Pace" hint="How full should your days be?">
          <Select value={form.energy_level ?? ""} onChange={(e) => set("energy_level", e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">Not set</option>
            {["Very relaxed", "Relaxed", "Balanced", "Active", "Very active"].map((l, i) => <option key={l} value={i + 1}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Favourite time of day">
          <ChipToggle options={TIMES} value={form.preferred_times ?? []} onChange={(v) => set("preferred_times", v as Profile["preferred_times"])} />
        </Field>
        <Field label="Travel style" className="sm:col-span-2">
          <ChipToggle options={STYLES} value={form.travel_styles ?? []} onChange={(v) => set("travel_styles", v)} />
        </Field>
        <Field label="Interests" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {interests.map((t) => {
              const on = form.interest_tag_ids?.includes(t.id);
              return (
                <button key={t.id} type="button" onClick={() => set("interest_tag_ids", on ? form.interest_tag_ids!.filter((x) => x !== t.id) : [...(form.interest_tag_ids ?? []), t.id])}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-brand bg-brand text-on-brand" : "border-border text-muted hover:text-text"}`}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.accessibility_needs ?? false} onChange={(e) => set("accessibility_needs", e.target.checked)} />
          I need wheelchair-accessible places <span className="text-muted">— we&apos;ll never suggest places marked inaccessible</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" variant="accent" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save preferences"}</Button>
        {save.isSuccess && <span className="text-sm text-ok">Saved. <Link href="/plan" className="font-semibold underline">Plan a trip →</Link></span>}
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </form>
  );
}

export default function ProfilePage() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: async () => unwrap(await api.GET("/profiles/me")) });
  if (profile.isLoading) return <Spinner />;
  if (profile.error) return <div className="p-6"><ErrorNote error={profile.error} /></div>;
  return <Suspense><ProfileForm initial={profile.data!} /></Suspense>;
}
