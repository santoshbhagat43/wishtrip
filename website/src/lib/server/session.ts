import type { NextResponse } from "next/server";

/** Only the website's server knows where the backend lives; browsers never see it. */
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
  ["POST", /^creators\/apply$/],
  ["GET", /^creators\/me$/],
  ["GET", /^creators\/me\/overview$/],
  ["POST", /^creator\/trips\/import$/],
  ["POST", /^creator\/trips\/from-reel$/],
  ["GET", /^creator\/trips\/imports\/[0-9a-f-]{36}$/],
  ["GET", /^creator\/trips$/],
  ["GET", /^creator\/trips\/[0-9a-f-]{36}$/],
  ["GET", /^creator\/links$/],
  ["POST", /^creator\/links$/],
  ["PATCH", /^creator\/links\/[0-9a-f-]{36}$/],
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
