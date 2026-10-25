import type { Metadata } from "next";

import { AryaSection } from "@/components/b4/arya";
import { HomeExplore } from "@/components/b4/home-explore";
import { buildSearchIndex } from "@/components/b4/home-search";
import { Creators, StartAndFooter, Trust } from "@/components/b4/sections";
import { ScrollStory } from "@/components/b4/story";
import { fetchCreators } from "@/lib/server/creators";
import { fetchDestinations } from "@/lib/server/destinations";

export const metadata: Metadata = {
  title: "wishtrip — Your whole trip, booked in one go",
  description: "Turn a reel or an idea into a planned, checked trip. Arya plans it, books it and stays with you till you’re home.",
};
// The creator trips and destinations below the story are live: never serve a stale list.
export const dynamic = "force-dynamic";

/** Home, as designed in the Option B4 "final white" prototype. The scroll story and Arya are
 *  illustrations (the example trip says so); the creator trips and destinations are the real ones. */
export default async function HomePage() {
  const [creators, destinations] = await Promise.all([fetchCreators(), fetchDestinations()]);
  return (
    <>
      <ScrollStory search={buildSearchIndex(creators, destinations)} />
      <AryaSection />
      <Trust />
      <HomeExplore creators={creators} destinations={destinations} />
      <Creators />
      <StartAndFooter />
    </>
  );
}
