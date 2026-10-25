import type { CreatorsIndex } from "@/lib/server/creators";
import type { DestinationCard } from "@/lib/server/destinations";

import type { SearchEntry } from "./header-search";
import { placesLabel, tripsLabel, where } from "./screens/destination-parts";

/** What the home page's search can find: the destinations, creators and creator trips we really
 *  have. Built from the same data as the pages those results open. */
export function buildSearchIndex(creators: CreatorsIndex | null, destinations: DestinationCard[] | null): SearchEntry[] {
  const index: SearchEntry[] = [];
  for (const d of destinations ?? []) {
    index.push({
      group: "Places",
      title: d.name,
      sub: [where(d), d.creator_trips > 0 ? tripsLabel(d.creator_trips) : placesLabel(d.place_count)].filter(Boolean).join(" · "),
      href: `/explore/${d.id}`,
      keys: [d.name, d.region, d.country ?? "", d.summary, ...d.highlights, d.top_creator?.handle ?? ""].join(" ").toLowerCase(),
      image: d.cover_image_url,
    });
  }
  for (const c of creators?.all ?? []) {
    index.push({
      group: "Creators",
      title: `@${c.handle}`,
      sub: `${c.display_name} · ${c.trips.length} ${c.trips.length === 1 ? "trip" : "trips"}`,
      href: `/creator/${encodeURIComponent(c.handle)}`,
      keys: `@${c.handle} ${c.handle} ${c.display_name}`.toLowerCase(),
      image: c.avatar_url ?? c.cover_image_url,
    });
    for (const t of c.trips) {
      index.push({
        group: "Trips",
        title: t.title,
        sub: `by @${c.handle} · ${t.days} ${t.days === 1 ? "day" : "days"}`,
        href: `/t/${t.share_code}`,
        keys: `${t.title} ${t.destination_name} ${t.summary} ${c.handle} ${c.display_name}`.toLowerCase(),
        image: t.cover_image_url,
      });
    }
  }
  return index;
}
