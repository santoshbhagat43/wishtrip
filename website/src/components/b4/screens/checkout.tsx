"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { LINKS } from "../data";
import { CARD, FlowHeader, Kicker } from "../flow";
import { kindLabel, useReelImport } from "../trip-journey";

/** Step 4: confirm the trip. Pricing and payment aren't live yet, so this puts the trip
 *  together and hands off — no invented totals. */
export function CheckoutScreen() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const imp = useReelImport(id);
  const content = imp.data?.content;
  const where = content?.destination_name || "your trip";
  const kept = content?.places.filter((p) => p.kind !== "area") ?? [];

  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader step={3} title={`Your ${where} trip`} subtitle="Book it in one go" back={`${LINKS.board}?id=${id}`} signedIn />
      <main className="mx-auto grid max-w-[1100px] grid-cols-1 items-start gap-8 px-4 pb-16 pt-8 md:grid-cols-[1fr_360px] md:px-10">
        <section className="flex flex-col gap-4">
          <div>
            <Kicker teal>BOOK IT IN ONE GO</Kicker>
            <h1 className="font-display mb-0 mt-1.5 text-[36px] font-medium leading-[1.08] md:text-[44px]">Almost there</h1>
            <p className="mb-0 mt-2 text-[15.5px] text-[#3F5A72]">
              We put flights, a stay and your {kept.length} places together into one trip. You confirm here, and our team sends the all-in price before anything is charged.
            </p>
          </div>
          <div className={`${CARD} flex flex-col gap-2.5 p-5`}>
            <Kicker>ON YOUR TRIP</Kicker>
            {kept.slice(0, 8).map((p) => (
              <span key={p.name} className="flex items-center justify-between gap-3 text-[13.5px]">
                <span className="font-semibold">{p.location_name ?? p.name}</span>
                <span className="text-[#8A7F72]">{kindLabel(p.kind)}</span>
              </span>
            ))}
          </div>
        </section>
        <aside className="md:sticky md:top-[100px]">
          <div className={`${CARD} flex flex-col gap-3 rounded-[22px] p-5`}>
            <Kicker>READY WHEN YOU ARE</Kicker>
            <p className="m-0 text-[14px] leading-normal text-[#566E85]">
              Confirm your trip and we’ll put it together — flights, stay and transfers — and send the all-in price to approve. Nothing is charged yet.
            </p>
            <button onClick={() => router.push(`${LINKS.bookings}?id=${id}`)} className="rounded-full bg-[#22DDE0] p-[15px] text-center text-base font-bold text-[#072338]">
              Confirm my trip
            </button>
            <span className="text-center text-xs text-[#566E85]">UPI, cards and net banking · secure payment at the final step</span>
          </div>
        </aside>
      </main>
      {!content && !imp.isLoading && (
        <p className="pb-10 text-center text-[#566E85]">We couldn’t find that trip. <Link href={LINKS.reel} className="font-semibold text-[#0A7C80] underline">Start from a reel</Link>.</p>
      )}
    </div>
  );
}
