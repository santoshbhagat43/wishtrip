import type { Metadata } from "next";

import { AryaSection } from "@/components/b4/arya";
import { CreatorReels, TravellerTrips } from "@/components/b4/lists";
import { Creators, Destinations, StartAndFooter, Trust } from "@/components/b4/sections";
import { ScrollStory } from "@/components/b4/story";

export const metadata: Metadata = {
  title: "wishtrip — Your whole trip, booked in one go",
  description: "Turn a reel or an idea into a planned, checked trip. Arya plans it, books it and stays with you till you’re home.",
};

/** Home, as designed in the Option B4 prototype (mobile and desktop). Static content for now. */
export default function HomePage() {
  return (
    <>
      <ScrollStory />
      <AryaSection />
      <Destinations />
      <CreatorReels />
      <TravellerTrips />
      <Creators />
      <Trust />
      <StartAndFooter />
    </>
  );
}
