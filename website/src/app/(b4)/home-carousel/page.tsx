import type { Metadata } from "next";

import { HomeCarouselScreen } from "@/components/b4/screens/home-carousel";

export const metadata: Metadata = { title: "wishtrip — reels made bookable" };

export default function Page() {
  return <HomeCarouselScreen />;
}
