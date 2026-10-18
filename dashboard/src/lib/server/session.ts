import type { NextResponse } from "next/server";

export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
// One session shared across every wishtrip app (website, creator, dashboard, sso). It is minted
// only by the SSO app and read everywhere; the role claim in the token decides who may use which
// app. Scoped to the parent domain so sibling subdomains all see it.
export const ACCESS_COOKIE = "wt_session";
export const REFRESH_COOKIE = "wt_refresh";

const secure = process.env.NODE_ENV === "production";
// e.g. ".listnr.co" (UAT), ".wishtrip.co" (prod), ".lvh.me" (local). Unset ⇒ host-only cookie.
const domain = process.env.SESSION_COOKIE_DOMAIN || undefined;

export type TokenPair = { access_token: string; refresh_token: string };

/** Tokens live in httpOnly cookies; browser code never sees them. */
export function setSessionCookies(response: NextResponse, tokens: TokenPair) {
  const base = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", domain };
  response.cookies.set(ACCESS_COOKIE, tokens.access_token, { ...base, maxAge: 60 * 30 });
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export function clearSessionCookies(response: NextResponse) {
  // A delete must carry the same domain/path the cookie was set with, or the browser keeps it.
  const base = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", domain, maxAge: 0 };
  response.cookies.set(ACCESS_COOKIE, "", base);
  response.cookies.set(REFRESH_COOKIE, "", base);
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
