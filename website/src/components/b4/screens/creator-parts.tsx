import Link from "next/link";

import type { CreatorCard, CreatorTripCard } from "@/lib/server/creators";

export const profileHref = (c: Pick<CreatorCard, "slug">) => `/creator/${encodeURIComponent(c.slug)}`;
export const tripHref = (t: Pick<CreatorTripCard, "share_code">) => `/t/${t.share_code}`;
export const CHANNEL = { instagram: "Instagram", youtube: "YouTube" } as Record<string, string>;
export const dayStops = (t: CreatorTripCard) =>
  `${t.days} ${t.days === 1 ? "day" : "days"} · ${t.stops} ${t.stops === 1 ? "stop" : "stops"}`;

/** A round avatar: the creator's initial (we hold no profile photos), in the brand colours. */
export function Avatar({ name, size = 56, ring = false, src }: { name: string; size?: number; ring?: boolean; src?: string | null }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`grid flex-none place-items-center rounded-full bg-gradient-to-br from-[#0A7C80] to-[#072338] font-display italic text-white ${
        ring ? "relative z-10 border-[3px] border-white shadow-[0_6px_20px_rgba(7,35,56,.25)]" : ""
      }`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- backend media
        <img src={src} alt="" className="size-full rounded-full object-cover" />
      ) : (
        name.trim().charAt(0).toUpperCase() || "W"
      )}
    </span>
  );
}

export function Cover({ src, className = "" }: { src?: string | null; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- backend media
    <img src={src} alt="" className={`size-full object-cover ${className}`} />
  ) : (
    <span className={`block size-full bg-gradient-to-br from-[#072338] to-[#0A7C80] ${className}`} />
  );
}

/** A creator as a card: cover, avatar, name and handle, and their latest trip. */
export function CreatorTile({ creator }: { creator: CreatorCard }) {
  const trip = creator.trips[0];
  return (
    <Link
      href={profileHref(creator)}
      className="group flex flex-col overflow-hidden rounded-[22px] border border-[#E3E8EE] bg-white no-underline transition hover:shadow-[0_10px_30px_rgba(7,35,56,.12)]"
    >
      <span className="relative block h-[120px] overflow-hidden bg-[#F3F6F9] md:h-[132px]">
        <Cover src={creator.cover_image_url} className="transition duration-300 group-hover:scale-[1.03]" />
        <span className="absolute right-3 top-3 rounded-full bg-[rgba(7,35,56,.78)] px-2.5 py-1 text-[11px] font-semibold text-white">
          {CHANNEL[creator.channel] ?? "Instagram"}
        </span>
      </span>
      <span className="-mt-7 flex flex-col gap-1 px-4 pb-4">
        <Avatar name={creator.display_name} src={creator.avatar_url} size={56} ring />
        <strong className="mt-1.5 text-[17px] leading-tight text-[#0D2436]">{creator.display_name}</strong>
        {creator.handle && <span className="text-[13.5px] font-medium text-[#0A7C80]">@{creator.handle}</span>}
        {trip && (
          <span className="mt-2 flex items-center gap-2.5 rounded-[14px] border border-[#E3E8EE] p-2">
            <span className="size-11 flex-none overflow-hidden rounded-[10px] bg-[#F3F6F9]">
              <Cover src={trip.cover_image_url} />
            </span>
            <span className="flex min-w-0 flex-col leading-snug">
              <strong className="truncate text-[13.5px] text-[#0D2436]">{trip.title}</strong>
              <span className="text-[12px] text-[#566E85]">{dayStops(trip)}</span>
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}
