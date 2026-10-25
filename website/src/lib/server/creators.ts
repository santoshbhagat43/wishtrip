import type { Schemas } from "@/lib/api/client";

import { BACKEND_URL } from "./session";

export type CreatorsIndex = Schemas["CreatorsIndex"];
export type CreatorPage = Schemas["CreatorPage"];
export type CreatorCard = Schemas["PublicCreatorCard"];
export type CreatorTripCard = Schemas["PublicTripCard"];

/** The public Creator trips data, read on the server so the page arrives already filled in.
 *  Always fresh: a creator who publishes a trip shows up straight away. */
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const fetchCreators = () => get<CreatorsIndex>("/explore/creators");
export const fetchCreator = (handle: string) => get<CreatorPage>(`/explore/creators/${encodeURIComponent(handle)}`);
