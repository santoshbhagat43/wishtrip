import type { Metadata } from "next";
import { Suspense } from "react";

import { B4Auth } from "@/components/b4/screens/auth";

export const metadata: Metadata = { title: "Join as a creator — wishtrip" };

export default function Page() {
  return (
    <Suspense>
      <B4Auth mode="login" only="creator" />
    </Suspense>
  );
}
