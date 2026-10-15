import type { NextResponse } from "next/server";

/** Only the website's server knows where the backend lives; browsers never see it. */
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
// Distinct per app: browsers share cookies across ports/subdomains of one host, so the
// staff dashboard and traveler site must never read each other's session.
export const ACCESS_COOKIE = "wishtrip_traveler_session";
export const REFRESH_COOKIE = "wishtrip_traveler_refresh";

const secure = process.env.NODE_ENV === "production";

export type TokenPair = { access_token: string; refresh_token: string };

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

/**
 * The traveler routes this site may reach. Anything else (staff/admin APIs) is refused here,
 * before it gets anywhere near the backend.
 */
const ALLOWED: [method: string, pattern: RegExp][] = [
  ["GET", /^auth\/me$/],
  ["GET", /^profiles\/me$/],
  ["PUT", /^profiles\/me$/],
  ["GET", /^profiles\/me\/saved$/],
  ["POST", /^profiles\/me\/events$/],
  ["GET", /^recommendations$/],
  ["GET", /^search\/semantic$/],
  ["GET", /^chat\/sessions$/],
  ["POST", /^chat\/sessions$/],
  ["GET", /^chat\/sessions\/[0-9a-f-]{36}$/],
  ["DELETE", /^chat\/sessions\/[0-9a-f-]{36}$/],
  ["POST", /^chat\/sessions\/[0-9a-f-]{36}\/messages$/],
  ["POST", /^reels\/imports$/],
  ["GET", /^creators\/me$/],
  ["POST", /^creator\/trips\/import$/],
  ["POST", /^creator\/trips\/from-reel$/],
  ["GET", /^creator\/trips\/imports\/[0-9a-f-]{36}$/],
  ["GET", /^creator\/trips$/],
  ["GET", /^creator\/trips\/[0-9a-f-]{36}$/],
  ["PATCH", /^creator\/trips\/[0-9a-f-]{36}$/],
  ["GET", /^trips\/[\w-]{3,64}$/],
  ["GET", /^reels\/imports\/[0-9a-f-]{36}$/],
  ["GET", /^explore\/(destinations|tags|menus)$/],
  ["GET", /^explore\/(destinations|places)\/[0-9a-f-]{36}$/],
  ["GET", /^support\/tickets$/],
  ["POST", /^support\/tickets$/],
  ["GET", /^support\/tickets\/[0-9a-f-]{36}$/],
  ["POST", /^support\/tickets\/[0-9a-f-]{36}\/messages$/],
];

export function isAllowed(method: string, path: string) {
  return ALLOWED.some(([m, pattern]) => m === method && pattern.test(path));
}
