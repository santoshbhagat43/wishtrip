import type { Metadata } from "next";
import { Suspense } from "react";

import { ReelScreen } from "@/components/b4/screens/reel";

export const metadata: Metadata = { title: "Your trip from this reel — wishtrip" };

export default function Page() {
  // The screen reads ?url= / ?id= from the address.
  return (
    <Suspense>
      <ReelScreen />
    </Suspense>
  );
}
