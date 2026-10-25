import type { Metadata } from "next";

import { DestinationsScreen } from "@/components/b4/screens/destinations";
import { fetchDestinations } from "@/lib/server/destinations";

export const metadata: Metadata = {
  title: "Destinations — wishtrip",
  description: "Places in wishtrip's checked travel knowledge, and the trips real travel creators have done there.",
};
export const dynamic = "force-dynamic";

export default async function Page() {
  return <DestinationsScreen destinations={await fetchDestinations()} />;
}
