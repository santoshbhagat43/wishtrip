import type { Metadata } from "next";

import { HomeAltScreen } from "@/components/b4/screens/home-alt";

export const metadata: Metadata = { title: "wishtrip — plan less, travel more" };

export default function Page() {
  return <HomeAltScreen />;
}
