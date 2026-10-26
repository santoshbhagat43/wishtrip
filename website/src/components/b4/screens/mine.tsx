"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { LINKS } from "../data";
import { FlowHeader } from "../flow";
import { useMineTrip } from "../trip-journey";
import { SharedTripScreen } from "./shared-trip";

/** "Make it mine", step two, at /trip/mine/<trip number>: a creator's trip shaped around the
 *  traveller's own details. The trip number brings back exactly what they made. */
export function MineScreen() {
  const { code } = useParams<{ code: string }>();
  const mine = useMineTrip(code);
  const m = mine.data;

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
        days: m.days,
        party: { adults: m.adults, kids: m.kids, seniors: m.seniors },
        pace: m.pace,
        when: m.when || undefined,
      }}
    />
  );
}
