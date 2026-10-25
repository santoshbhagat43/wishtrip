// Shared by the creator dashboard.

/** The traveller site a creator's links point at — the same setting the admin dashboard uses. */
export const WEBSITE_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "https://wishtrip.listnr.co";

/** The creator's overall link: credits them whichever page the visitor lands on. */
export const overallLink = (referralCode: string) => `${WEBSITE_URL}/creator/${referralCode}`;

/** A short link for one reel; opening it lands the traveller on the destination the creator chose. */
export const reelLink = (code: string) => `${WEBSITE_URL}/r/${code}`;

/** The link as it reads on screen: without the scheme, so it fits and looks like a short link. */
export const withoutScheme = (url: string) => url.replace(/^https?:\/\//, "");

export function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
