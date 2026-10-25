import type { DestinationCard } from "@/lib/server/destinations";

const GRADIENTS: [from: string, to: string][] = [
  ["#072338", "#0A7C80"],
  ["#0B3550", "#1A6094"],
  ["#124A72", "#14A3A8"],
  ["#072338", "#4A6F8C"],
  ["#0A4F57", "#2F8F9D"],
  ["#1B2F4E", "#0A7C80"],
];
const gradientFor = (name: string) => GRADIENTS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % GRADIENTS.length];

/** The summary we hold, unless it is only the auto-made "X — part of Y" line. */
export function describe(d: DestinationCard): string {
  const summary = d.summary.trim();
  if (summary && !/—\s*part of\s/i.test(summary)) return summary;
  return d.highlights[0] ?? "";
}

/** "Kerala, India" or just "Japan": the region only when it adds something. */
export const where = (d: DestinationCard) => {
  const region = d.region && d.region !== d.name && d.region !== d.country ? d.region : null;
  return [region, d.country].filter(Boolean).join(", ");
};
export const placesLabel = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;
export const tripsLabel = (n: number) => `${n} creator ${n === 1 ? "trip" : "trips"}`;
export const isIndia = (d: DestinationCard) => (d.country ?? "").toLowerCase() === "india";

/** A destination's picture: the cover of a creator's trip there, else a brand gradient. We hold no
 *  destination photos of our own, so nothing here is a stock image. */
export function Photo({ d, className = "" }: { d: DestinationCard; className?: string }) {
  return d.cover_image_url ? (
    // eslint-disable-next-line @next/next/no-img-element -- backend media
    <img src={d.cover_image_url} alt="" className={`size-full object-cover ${className}`} />
  ) : (
    <span
      aria-hidden
      className={`block size-full ${className}`}
      style={{
        // A soft highlight over the brand gradient, different for each place.
        backgroundImage: `radial-gradient(circle at 28% 18%, rgba(255,255,255,.22), transparent 55%), linear-gradient(145deg, ${gradientFor(d.name).join(", ")})`,
      }}
    />
  );
}

/** Says whose picture it is when the photo is a hotel's (TripJack), not a creator's own cover. */
export function PhotoCredit({ d }: { d: DestinationCard }) {
  if (d.cover_source !== "hotel" || !d.cover_credit) return null;
  return (
    <span className="absolute bottom-2 right-2 max-w-[70%] truncate rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
      Photo: {d.cover_credit}
    </span>
  );
}
