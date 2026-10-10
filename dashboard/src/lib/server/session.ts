import type { NextResponse } from "next/server";

export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
// Distinct per app: browsers share cookies across ports/subdomains of one host, so the
// staff dashboard and traveler site must never read each other's session.
export const ACCESS_COOKIE = "wishtrip_staff_session";
export const REFRESH_COOKIE = "wishtrip_staff_refresh";

const secure = process.env.NODE_ENV === "production";

export type TokenPair = { access_token: string; refresh_token: string };

/** Tokens live in httpOnly cookies; browser code never sees them. */
export function setSessionCookies(response: NextResponse, tokens: TokenPair) {
  const base = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
  response.cookies.set(ACCESS_COOKIE, tokens.access_token, { ...base, maxAge: 60 * 30 });
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
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
