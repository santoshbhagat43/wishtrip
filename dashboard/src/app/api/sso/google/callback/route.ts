import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";
import { googleRedirectUri, safeRedirect, SSO_URL } from "@/lib/server/sso";

const STATE_COOKIE = "wt_oauth_state";

/** Google returns here with ?code&state. Verify the CSRF nonce, hand the code to the backend to
 *  exchange for a wishtrip session, set the shared cookie, and return the user to their app. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const loginPage = `${SSO_URL}/sso/login`;

  const raw = request.cookies.get(STATE_COOKIE)?.value;
  let saved: { nonce?: string; redirect?: string } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    saved = {};
  }

  const fail = (reason: string) => {
    const url = new URL(loginPage);
    url.searchParams.set("error", reason);
    if (saved.redirect) url.searchParams.set("redirect", saved.redirect);
    const r = NextResponse.redirect(url);
    r.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return r;
  };

  if (params.get("error")) return fail("google_denied");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !saved.nonce || state !== saved.nonce) return fail("google_state");

  const res = await fetch(`${BACKEND_URL}/auth/google/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: googleRedirectUri() }),
    cache: "no-store",
  });
  if (!res.ok) return fail("google_exchange");
  const tokens = (await res.json()) as TokenPair;

  const response = NextResponse.redirect(safeRedirect(saved.redirect));
  response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  setSessionCookies(response, tokens);
  return response;
}
