import type { Tone } from "@/components/ui/badge";

/** Where creator links point: the traveller website. */
export const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "https://wishtrip.listnr.co";

export const referralLink = (code: string) => `${WEBSITE_URL}/c/${code}`;

export const CREATOR_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending approval", tone: "warn" },
  unclaimed: { label: "Unclaimed", tone: "neutral" },
  invited: { label: "Invited", tone: "info" },
  active: { label: "Affiliate", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
};

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
