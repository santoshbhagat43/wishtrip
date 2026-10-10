import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";

export async function POST(request: NextRequest) {
  const res = await fetch(`${BACKEND_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ detail: body.detail ?? "Sign-up failed" }, { status: res.status });
  const response = NextResponse.json({ ok: true }, { status: 201 });
  setSessionCookies(response, body as TokenPair);
  return response;
}
