import type { Tone } from "@/components/ui/badge";

/** Where creator links point: the traveller website. */
export const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "https://wishtrip.listnr.co";

/** A short link for one reel; opening it lands the traveller on the destination the creator chose. */
export const reelLink = (code: string) => `${WEBSITE_URL}/r/${code}`;

/** A link as it reads on screen: without the scheme, so it fits and looks like a short link. */
export const withoutScheme = (url: string) => url.replace(/^https?:\/\//, "");

export const referralLink = (code: string) => `${WEBSITE_URL}/creator/${code}`;

export const CREATOR_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending approval", tone: "warn" },
  unclaimed: { label: "Unclaimed", tone: "neutral" },
  invited: { label: "Invited", tone: "info" },
  active: { label: "Affiliate", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
};

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
