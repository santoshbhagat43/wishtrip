import type { NextRequest } from "next/server";

/** The SSO app's absolute base, e.g. http://sso.lvh.me:3001 or https://sso.listnr.co. All
 *  env-driven so the move from listnr.co (UAT) to wishtrip.co (prod) is config, not code. */
export const SSO_URL = process.env.SSO_URL ?? "";

/** Build the SSO login link to send a visitor to, remembering where to return them. */
export function ssoLoginUrl(returnTo: string, reason?: string): string {
  const u = new URL(`${SSO_URL}/sso/login`);
  u.searchParams.set("redirect", returnTo);
  if (reason) u.searchParams.set("reason", reason);
  return u.toString();
}

/** This request's public origin (from the Host header, which Caddy sets to the real domain). */
export function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** The creator site's public origin, e.g. http://creator.lvh.me:3003 or https://creator.listnr.co.
 *  Its own app (the creator/ project); this site links and redirects there. */
export const CREATOR_URL = process.env.CREATOR_URL ?? "";

/** The traveller website's public origin, e.g. http://app.lvh.me:3002 or https://wishtrip.listnr.co.
 *  Where the creator site sends visitors who aren't signed in (the creator programme lives there). */
export const SITE_URL = process.env.SITE_URL ?? "";

/** The SSO login opened on creator sign-in (one-time code, email or WhatsApp, or Google). */
export function creatorSsoUrl(returnTo: string): string {
  const u = new URL(ssoLoginUrl(returnTo));
  u.searchParams.set("for", "creator");
  return u.toString();
}
