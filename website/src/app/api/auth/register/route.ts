import { NextResponse, type NextRequest } from "next/server";

import { LINK_COOKIE, REF_COOKIE, VISITOR_COOKIE } from "@/lib/server/referral";
import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";

export async function POST(request: NextRequest) {
  const res = await fetch(`${BACKEND_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Credit the creator whose link brought this visitor here (set by /c/<code>).
    body: JSON.stringify({
      ...(await request.json()),
      referral_code: request.cookies.get(REF_COOKIE)?.value ?? null,
      visitor_id: request.cookies.get(VISITOR_COOKIE)?.value ?? "",
      link_code: request.cookies.get(LINK_COOKIE)?.value ?? null,
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ detail: body.detail ?? "Sign-up failed" }, { status: res.status });
  const response = NextResponse.json({ ok: true }, { status: 201 });
  setSessionCookies(response, body as TokenPair);
  return response;
}
