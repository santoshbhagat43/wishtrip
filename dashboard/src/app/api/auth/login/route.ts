import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";

export async function POST(request: NextRequest) {
  const credentials = await request.json();
  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ detail: body.detail ?? "Sign-in failed" }, { status: res.status });
  }
  const tokens = (await res.json()) as TokenPair;
  const me = await fetch(`${BACKEND_URL}/auth/me`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  }).then((r) => r.json());
  if (me.role === "traveler") {
    return NextResponse.json(
      { detail: "The dashboard is for WishTrip staff. Traveler accounts can't sign in here." },
      { status: 403 },
    );
  }
  const response = NextResponse.json(me);
  setSessionCookies(response, tokens);
  return response;
}
