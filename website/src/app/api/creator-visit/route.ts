import { NextResponse, type NextRequest } from "next/server";

import { REF_COOKIE, REF_MAX_AGE, VISITOR_COOKIE } from "@/lib/server/referral";
import { BACKEND_URL } from "@/lib/server/session";

/** A visitor opened a creator's shared trip link: credit the creator (first touch wins). */
export async function POST(request: NextRequest) {
  const { referralCode } = (await request.json().catch(() => ({}))) as { referralCode?: string };
  if (!referralCode) return NextResponse.json({ ok: false }, { status: 400 });

  const visitor = request.cookies.get(VISITOR_COOKIE)?.value ?? crypto.randomUUID();
  const response = NextResponse.json({ ok: true });
  const res = await fetch(`${BACKEND_URL}/referrals/${encodeURIComponent(referralCode)}/visit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitor_id: visitor }),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return response;

  const base = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
  response.cookies.set(VISITOR_COOKIE, visitor, { ...base, maxAge: REF_MAX_AGE });
  if (!request.cookies.has(REF_COOKIE)) response.cookies.set(REF_COOKIE, referralCode, { ...base, maxAge: REF_MAX_AGE });
  return response;
}
