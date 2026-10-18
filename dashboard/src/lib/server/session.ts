import type { NextResponse } from "next/server";

export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const secure = process.env.NODE_ENV === "production";

export type TokenPair = { access_token: string; refresh_token: string };

// ---------------------------------------------------------------------------------------------
// The admin dashboard's own session. Separate from SSO on purpose: staff sign in on the
// dashboard's /login, and the cookie is host-only, so it is never sent to the website, the
// creator site or the SSO app — and a traveller's or creator's SSO session means nothing here.
// ---------------------------------------------------------------------------------------------
export const ACCESS_COOKIE = "wishtrip_admin_session";
export const REFRESH_COOKIE = "wishtrip_admin_refresh";

/** Tokens live in httpOnly cookies; browser code never sees them. */
export function setSessionCookies(response: NextResponse, tokens: TokenPair) {
  const base = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
  response.cookies.set(ACCESS_COOKIE, tokens.access_token, { ...base, maxAge: 60 * 30 });
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export function clearSessionCookies(response: NextResponse) {
  const base = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 0 };
  response.cookies.set(ACCESS_COOKIE, "", base);
  response.cookies.set(REFRESH_COOKIE, "", base);
}

// ---------------------------------------------------------------------------------------------
// The shared SSO session, for travellers and creators. This app only *mints* it, from the SSO
// host (sso.<domain>); the website and creator site read it. Scoped to the parent domain so
// every sibling subdomain sees it: ".listnr.co" (UAT), ".wishtrip.co" (prod), ".lvh.me" (local).
// ---------------------------------------------------------------------------------------------
export const SHARED_ACCESS_COOKIE = "wt_session";
export const SHARED_REFRESH_COOKIE = "wt_refresh";
const sharedDomain = process.env.SESSION_COOKIE_DOMAIN || undefined;

export function setSharedSessionCookies(response: NextResponse, tokens: TokenPair) {
  const base = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", domain: sharedDomain };
  response.cookies.set(SHARED_ACCESS_COOKIE, tokens.access_token, { ...base, maxAge: 60 * 30 });
  response.cookies.set(SHARED_REFRESH_COOKIE, tokens.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export function clearSharedSessionCookies(response: NextResponse) {
  // A delete must carry the same domain/path the cookie was set with, or the browser keeps it.
  const base = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", domain: sharedDomain, maxAge: 0 };
  response.cookies.set(SHARED_ACCESS_COOKIE, "", base);
  response.cookies.set(SHARED_REFRESH_COOKIE, "", base);
}

/** The role claim, read WITHOUT verifying the signature — for routing/redirects only. Real
 *  authorization is always enforced by the backend on each API call. */
export function roleFromToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
  return res.ok ? ((await res.json()) as TokenPair) : null;
}
