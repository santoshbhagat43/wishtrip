import type { Metadata } from "next";

import { TripScreen } from "@/components/b4/screens/trip";

export const metadata: Metadata = { title: "Slow North Goa — a creator trip — wishtrip" };

export default function Page() {
  return <TripScreen />;
}
