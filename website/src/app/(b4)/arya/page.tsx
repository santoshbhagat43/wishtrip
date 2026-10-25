import type { Metadata } from "next";
import { Suspense } from "react";

import { AryaPlanner } from "@/components/arya/planner";

export const metadata: Metadata = {
  title: "Arya — plan your trip — wishtrip",
  description: "Tell Arya the trip you're dreaming of. She plans it from places wishtrip has checked.",
};

/** Arya, the real planner (the old /plan). Signed-out visitors are sent to sign in by the proxy. */
export default function Page() {
  return (
    <Suspense>
      <AryaPlanner />
    </Suspense>
  );
}
