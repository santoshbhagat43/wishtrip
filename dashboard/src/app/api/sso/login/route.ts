import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";
import { safeRedirect } from "@/lib/server/sso";

/** Password sign-in for any wishtrip user. Mints the shared session cookie and tells the client
 *  where to go back to; role-based access is enforced by each destination app. */
export async function POST(request: NextRequest) {
  const { email, password, redirect } = await request.json();
  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ detail: body.detail ?? "Sign-in failed" }, { status: res.status });
  }
  const response = NextResponse.json({ ok: true, redirect: safeRedirect(redirect) });
  setSessionCookies(response, body as TokenPair);
  return response;
}
