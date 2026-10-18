import type { NextRequest } from "next/server";

/** Helpers that tell the dashboard app when it is acting as the SSO host, and where the SSO
 *  app lives, so the staff dashboard can bounce signed-out users to it. All env-driven, so moving
 *  from listnr.co (UAT) to wishtrip.co (prod) is a config change, not a code change. */

/** The SSO app's own absolute base, e.g. http://sso.lvh.me:3001 or https://sso.listnr.co. */
export const SSO_URL = process.env.SSO_URL ?? "";

/** Where to send a user who finishes signing in without a specific destination. */
const POST_LOGIN_FALLBACK = process.env.POST_LOGIN_FALLBACK_URL || SSO_URL || "/";

/** Build the SSO login link that other apps redirect to. */
export function ssoLoginUrl(returnTo: string, reason?: string): string {
  const u = new URL(`${SSO_URL}/sso/login`);
  u.searchParams.set("redirect", returnTo);
  if (reason) u.searchParams.set("reason", reason);
  return u.toString();
}

/** This request's public origin (from the Host header, which Caddy sets to the real domain) —
 *  not the container's internal address. */
export function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Does this request's Host belong to the SSO app (vs the staff dashboard)? */
export function isSsoHost(host: string | null | undefined): boolean {
  if (!host) return false;
  if (SSO_URL) {
    try {
      return new URL(SSO_URL).host === host;
    } catch {
      /* fall through */
    }
  }
  return host.split(":")[0].startsWith("sso.");
}

/** The exact redirect URI registered with Google, canonical per environment. */
export function googleRedirectUri(): string {
  return `${SSO_URL}/api/sso/google/callback`;
}

// Only ever bounce back to our own domains. Add ".wishtrip.co" is already covered for prod.
const SUFFIXES = (process.env.SSO_REDIRECT_SUFFIXES ?? ".listnr.co,.lvh.me,.wishtrip.co")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Validate a `?redirect=` target: an absolute http(s) URL on one of our domains, else fallback. */
export function safeRedirect(target: string | null | undefined, fallback = POST_LOGIN_FALLBACK): string {
  if (!target) return fallback;
  try {
    const u = new URL(target);
    const host = u.hostname;
    const onOurDomain =
      host === "localhost" ||
      SUFFIXES.some((suf) => host === suf.replace(/^\./, "") || host.endsWith(suf));
    if ((u.protocol === "http:" || u.protocol === "https:") && onOurDomain) return u.toString();
  } catch {
    /* not a valid absolute URL */
  }
  return fallback;
}
