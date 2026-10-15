import type { Metadata } from "next";
import { Suspense } from "react";

import { DetailsScreen } from "@/components/b4/screens/details";

export const metadata: Metadata = { title: "Your details — wishtrip" };

export default function Page() {
  return (
    <Suspense>
      <DetailsScreen />
    </Suspense>
  );
}
