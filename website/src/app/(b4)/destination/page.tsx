import type { Metadata } from "next";

import { DestinationScreen } from "@/components/b4/screens/destination";

export const metadata: Metadata = { title: "Goa — wishtrip" };

export default function Page() {
  return <DestinationScreen />;
}
