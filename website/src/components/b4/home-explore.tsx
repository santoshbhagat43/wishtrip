import Link from "next/link";

import type { CreatorsIndex } from "@/lib/server/creators";
import type { DestinationCard } from "@/lib/server/destinations";

import { CreatorSpotlight, type SpotlightTrip } from "./creator-spotlight";
import { Photo, placesLabel, tripsLabel } from "./screens/destination-parts";

/** The creator trips to feature: the spotlight creator's trips first, then the newest of the rest,
 *  each creator's newest trip once. */
function spotlightTrips(data: CreatorsIndex | null): SpotlightTrip[] {
  if (!data) return [];
  const out: SpotlightTrip[] = [];
  const seen = new Set<string>();
  const add = (c: CreatorsIndex["all"][number], t: CreatorsIndex["all"][number]["trips"][number], tag: string | null) => {
    if (seen.has(t.share_code)) return;
    seen.add(t.share_code);
    out.push({ ...t, handle: c.handle, creator: c.display_name, tag });
  };
  if (data.spotlight) {
    const [lead, ...rest] = data.spotlight.trips;
    if (lead) add(data.spotlight, lead, data.spotlight_chosen ? "In the spotlight" : null);
    for (const t of rest) add(data.spotlight, t, null);
  }
  for (const c of data.all) if (c.trips[0]) add(c, c.trips[0], null);
  for (const c of data.all) for (const t of c.trips.slice(1)) add(c, t, null);
  return out.slice(0, 8);
}

/** The dark band after the trust points: real creator trips, then real destinations. Each part
 *  appears only when there is something real to show. */
export function HomeExplore({ creators, destinations }: { creators: CreatorsIndex | null; destinations: DestinationCard[] | null }) {
  const trips = spotlightTrips(creators);
  const places = [...(destinations ?? [])].sort((a, b) => b.creator_trips - a.creator_trips || b.place_count - a.place_count).slice(0, 12);
  if (trips.length === 0 && places.length === 0) return null;

  return (
    <section
      id="b4-explore"
      className="bg-[linear-gradient(180deg,#0B3550_0%,#06243A_28%,#041A2C_100%)] px-4 py-12 text-white md:px-10 md:py-[88px]"
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-14 md:gap-20">
        {trips.length > 0 && <CreatorSpotlight trips={trips} />}

        {places.length > 0 && (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-sans! m-0 text-[24px] font-bold tracking-tight md:text-[30px]">Destinations to explore</h2>
                <p className="m-0 mt-1 text-[14px] text-[#C9DAE6] md:text-[15.5px]">Places in WishTrip&rsquo;s checked travel knowledge, and who has been.</p>
              </div>
              <Link href="/destinations" className="text-[14.5px] font-semibold text-[#6BEDEF] no-underline hover:underline">
                See all ›
              </Link>
            </div>
            <ul className="rail m-0 mt-6 flex list-none snap-x gap-4 overflow-x-auto p-0 pb-2">
              {places.map((d) => (
                <li key={d.id} className="w-[200px] flex-none snap-start">
                  <Link href={`/explore/${d.id}`} className="group flex flex-col gap-2.5 text-white no-underline">
                    <span className="relative block h-[290px] overflow-hidden rounded-[20px] bg-[#0A3A57]">
                      <Photo d={d} className="transition duration-300 group-hover:scale-[1.04]" />
                      <span className="absolute inset-0 bg-gradient-to-t from-[#041A2C]/85 via-transparent to-transparent" />
                      {(d.country ?? d.region) && (
                        <span className="absolute left-2.5 top-2.5 rounded-md bg-[#6BEDEF] px-2 py-1 text-[11px] font-bold text-[#072338]">
                          {d.country ?? d.region}
                        </span>
                      )}
                      <span className="font-sans absolute inset-x-3 bottom-3 text-[24px] font-bold leading-tight">{d.name}</span>
                    </span>
                    <span className="px-0.5 text-[13px] leading-snug text-[#C9DAE6]">
                      {placesLabel(d.place_count)}
                      {d.creator_trips > 0 && <span className="block font-semibold text-[#6BEDEF]">{tripsLabel(d.creator_trips)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
