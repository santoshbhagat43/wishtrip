import type { Metadata } from "next";

import { CreatorTripsScreen } from "@/components/b4/screens/creator-trips";
import { fetchCreators } from "@/lib/server/creators";

export const metadata: Metadata = {
  title: "Creator trips — wishtrip",
  description: "Trips made by travel creators you already follow. Book it as they did it, or let Arya make it yours.",
};
// Creators publish trips all the time: never serve a stale list.
export const dynamic = "force-dynamic";

export default async function Page() {
  return <CreatorTripsScreen data={await fetchCreators()} />;
}
