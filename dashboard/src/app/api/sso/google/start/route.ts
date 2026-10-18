import { randomBytes } from "crypto";

import { NextResponse, type NextRequest } from "next/server";

import { googleRedirectUri, safeRedirect } from "@/lib/server/sso";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_COOKIE = "wt_oauth_state";

/** Begin Google sign-in: stash a CSRF nonce + the return URL in a short-lived cookie, then send
 *  the browser to Google's consent screen. */
export function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ detail: "Google sign-in is not configured" }, { status: 503 });
  }
  const redirect = safeRedirect(request.nextUrl.searchParams.get("redirect"));
  const nonce = randomBytes(16).toString("hex");

  const auth = new URL(GOOGLE_AUTH_URL);
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", googleRedirectUri());
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", nonce);
  auth.searchParams.set("access_type", "online");
  auth.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(auth.toString());
  response.cookies.set(STATE_COOKIE, JSON.stringify({ nonce, redirect }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
