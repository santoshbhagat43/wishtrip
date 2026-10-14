import type { Metadata } from "next";

import { BookedScreen } from "@/components/b4/screens/booked";

export const metadata: Metadata = { title: "Booked — wishtrip" };

export default function Page() {
  return <BookedScreen />;
}
