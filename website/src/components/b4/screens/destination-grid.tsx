"use client";

import Link from "next/link";
import { useState } from "react";

import type { DestinationCard } from "@/lib/server/destinations";

import { isIndia, Photo, PhotoCredit, placesLabel, tripsLabel, where } from "./destination-parts";

type Filter = "all" | "india" | "abroad";

/** Every destination, with All / India / Abroad filters when there are both. */
export function DestinationGrid({ destinations }: { destinations: DestinationCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const india = destinations.filter(isIndia).length;
  const filters: [Filter, string][] = [["all", "All"]];
  if (india > 0 && india < destinations.length) filters.push(["india", "India"], ["abroad", "Abroad"]);
  const shown = destinations.filter((d) => filter === "all" || (filter === "india" ? isIndia(d) : !isIndia(d)));

  return (
    <>
      {filters.length > 1 && (
        <div role="group" aria-label="Filter destinations" className="mt-5 flex flex-wrap gap-2">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-4 py-2 text-[13.5px] font-semibold transition ${
                filter === key ? "bg-[#072338] text-white" : "border border-[#E3E8EE] bg-white text-[#0D2436] hover:bg-[#F3F6F9]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <ul className="m-0 mt-6 grid list-none grid-cols-2 gap-x-4 gap-y-7 p-0 md:grid-cols-3 lg:grid-cols-4">
        {shown.map((d) => (
          <li key={d.id}>
            <Link href={`/explore/${d.id}`} className="group flex flex-col gap-2.5 no-underline">
              <span className="relative block aspect-[3/4] overflow-hidden rounded-[22px] bg-[#072338]">
                <Photo d={d} className="transition duration-300 group-hover:scale-[1.04]" />
                <span className="absolute inset-0 bg-gradient-to-t from-[#072338]/80 via-transparent to-transparent" />
                {d.creator_trips > 0 && (
                  <span className="absolute left-3 top-3 rounded-full bg-[#DCF8F9] px-2.5 py-1 text-[11px] font-bold text-[#0A6B6E]">
                    {tripsLabel(d.creator_trips)}
                  </span>
                )}
                <span className="font-display absolute inset-x-4 bottom-8 text-[26px] font-medium leading-tight text-white">{d.name}</span>
                <PhotoCredit d={d} />
              </span>
              <span className="flex flex-col gap-0.5 px-1 text-[13px] leading-snug text-[#566E85]">
                <span>
                  {where(d)} · {placesLabel(d.place_count)}
                </span>
                {d.top_creator && (
                  <span className="font-semibold text-[#0A7C80]">Top trip by {d.top_creator.handle ? `@${d.top_creator.handle}` : d.top_creator.display_name}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
