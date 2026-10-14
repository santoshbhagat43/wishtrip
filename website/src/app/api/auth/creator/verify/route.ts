import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";

/** Creator sign-in step 2: verify the code and start a session. */
export async function POST(request: NextRequest) {
  const res = await fetch(`${BACKEND_URL}/auth/creator/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ detail: body.detail ?? "That code didn't work" }, { status: res.status });
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, body as TokenPair);
  return response;
}
