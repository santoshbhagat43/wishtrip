import { NextResponse, type NextRequest } from "next/server";

import { REF_COOKIE, REF_COOKIE_DOMAIN, REF_MAX_AGE, VISITOR_COOKIE } from "@/lib/server/referral";
import { BACKEND_URL } from "@/lib/server/session";

/** A creator's link (wishtrip…/c/<code>): remember who sent this visitor, then show the site. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const visitor = request.cookies.get(VISITOR_COOKIE)?.value ?? crypto.randomUUID();
  // Relative redirect: behind the proxy, request.url is the container's own address.
  // From a creator's page (/creator/<code>): count the visit and set the cookies, show nothing.
  const quiet = request.nextUrl.searchParams.has("beacon");
  const response = quiet
    ? new NextResponse(null, { status: 204 })
    : new NextResponse(null, { status: 307, headers: { Location: "/" } });

  const res = await fetch(`${BACKEND_URL}/referrals/${encodeURIComponent(code)}/visit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitor_id: visitor }),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return response; // unknown code: just the home page

  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    domain: REF_COOKIE_DOMAIN,
  };
  response.cookies.set(VISITOR_COOKIE, visitor, { ...base, maxAge: REF_MAX_AGE });
  // First touch wins: a later creator's link doesn't replace the first one.
  if (!request.cookies.has(REF_COOKIE)) {
    const { referral_code } = (await res.json()) as { referral_code: string };
    response.cookies.set(REF_COOKIE, referral_code, { ...base, maxAge: REF_MAX_AGE });
  }
  return response;
}
