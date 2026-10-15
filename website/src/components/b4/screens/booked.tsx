"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { LINKS } from "../data";
import { CARD, DonePill, FlowHeader } from "../flow";
import { useReelImport } from "../trip-journey";

/** Step 5: confirmed. The trip is being put together; the team follows up with the price. */
export function BookedScreen() {
  const id = useSearchParams().get("id");
  const imp = useReelImport(id);
  const where = imp.data?.content?.destination_name || "your trip";

  return (
    <div className="min-h-dvh bg-[#FBF8F4]">
      <FlowHeader title="Booked" subtitle={`Your ${where} trip`} signedIn nav />
      <main className="mx-auto flex max-w-[620px] flex-col gap-4 px-4 py-16 text-center">
        <span className="self-center"><DonePill size={13}>Trip confirmed</DonePill></span>
        <h1 className="font-display m-0 text-[40px] font-medium leading-[1.06]">You’re going to {where}! 🎉</h1>
        <p className="m-0 text-[15.5px] leading-[1.55] text-[#3F5A72]">
          Your trip is being put together. Our team will send the all-in price and the day-by-day to approve — nothing is charged until you say yes.
        </p>
        <div className={`${CARD} mt-2 flex flex-col gap-2 p-5 text-left`}>
          <strong className="text-[15px]">What happens next</strong>
          <span className="text-[13.5px] text-[#566E85]">We confirm flights, your stay and the places from your reel, then message you with the all-in price and your full itinerary.</span>
        </div>
        <Link href={LINKS.home} className="mt-2 self-center rounded-full border-[1.5px] border-[#072338] px-6 py-3 text-[15px] font-semibold text-[#072338] no-underline">
          Back to wishtrip
        </Link>
      </main>
    </div>
  );
}
