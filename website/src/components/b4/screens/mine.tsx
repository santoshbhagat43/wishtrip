"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";

import { api, unwrap } from "@/lib/api/client";

import { LINKS } from "../data";
import { FlowHeader } from "../flow";
import { useMineTrip } from "../trip-journey";
import { SharedTripScreen } from "./shared-trip";

/** "Make it mine", step two, at /trip/mine/<trip number>: a trip planned for the traveller's own
 *  party (solo, couple, family, elderly or a mixed group). It is built in the background, so the
 *  page shows it filling in and settles when the plan is ready. The trip number brings it back. */
export function MineScreen() {
  const { code } = useParams<{ code: string }>();
  const queryClient = useQueryClient();
  const mine = useMineTrip(code);
  const m = mine.data;

  // The same details again: plans the trip afresh (after a failure).
  const retry = useMutation({
    mutationFn: async () => {
      if (!m) return null;
      return unwrap(
        await api.PATCH("/my-trips/{code}", {
          params: { path: { code } },
          body: { adults: m.adults, kids: m.kids, seniors: m.seniors, days: m.days, pace: m.pace, when: m.when, group: m.group, arya: false,
            start_date: m.start_date ?? null, origin: m.origin ?? "", origin_city: m.origin_city ?? "", budget: m.budget ?? "", notes: m.notes ?? "" },
        }),
      );
    },
    onSuccess: (fresh) => fresh && queryClient.setQueryData(["mine-trip", code], fresh),
  });

  if (!m) {
    return (
      <div className="min-h-dvh bg-[#FFFFFF]">
        <FlowHeader nav title="Your trip" subtitle={mine.isLoading ? "Loading" : "Not found"} back={LINKS.home} signedIn />
        {mine.isLoading ? (
          <p className="p-10 text-center text-[#566E85]">Loading your trip…</p>
        ) : (
          <main className="mx-auto max-w-[640px] px-6 py-16">
            <h1 className="font-display text-[32px] font-medium leading-tight">We couldn’t find that trip</h1>
            <p className="mt-2 text-[#566E85]">Check the trip number, or start again from the trip you liked.</p>
            <Link href={LINKS.creators} className="mt-6 inline-block rounded-full bg-[#22DDE0] px-6 py-3 text-base font-bold text-[#072338] no-underline">
              See creator trips
            </Link>
          </main>
        )}
      </div>
    );
  }
  return (
    <SharedTripScreen
      preloaded={m}
      mine={{
        code: m.code,
        source: m.source_share_code,
        importId: m.import_id,
        days: m.days,
        party: { adults: m.adults, kids: m.kids, seniors: m.seniors },
        pace: m.pace,
        when: m.when || undefined,
        originCity: m.origin_city || undefined,
        start: m.start_date || undefined,
        build: {
          status: m.build_status,
          error: m.build_error,
          persona: m.persona,
          aiBuilt: m.ai_built,
          summary: m.plan_summary,
          tips: m.tips ?? [],
          fromReel: !m.source_share_code,
        },
        retry: () => retry.mutate(),
      }}
    />
  );
}
