import type { Schemas } from "@/lib/api/client";

import { BACKEND_URL } from "./session";

export type DestinationCard = Schemas["Destination-Output"];

/** The published destinations (cities with places), with the creator trips that went there.
 *  Read on the server and always fresh. Null when the backend can't be reached. */
export async function fetchDestinations(): Promise<DestinationCard[] | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/explore/destinations`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as DestinationCard[]) : null;
  } catch {
    return null;
  }
}
