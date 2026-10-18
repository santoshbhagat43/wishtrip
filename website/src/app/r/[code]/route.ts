import { NextResponse, type NextRequest } from "next/server";

import { LINK_COOKIE, REF_COOKIE, REF_COOKIE_DOMAIN, REF_MAX_AGE, VISITOR_COOKIE } from "@/lib/server/referral";
import { BACKEND_URL } from "@/lib/server/session";

/**
 * A creator's reel link (wishtrip…/r/<code>), the short link they put in one reel's caption or
 * bio. Credits the creator and that link, remembers who sent this visitor, then lands them on the
 * destination the creator chose (or the home page).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const visitor = request.cookies.get(VISITOR_COOKIE)?.value ?? crypto.randomUUID();

  const res = await fetch(`${BACKEND_URL}/referrals/links/${encodeURIComponent(code)}/visit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitor_id: visitor }),
    cache: "no-store",
  }).catch(() => null);
  // Relative redirects: behind the proxy, request.url is the container's own address.
  if (!res?.ok) return new NextResponse(null, { status: 307, headers: { Location: "/" } }); // unknown link

  const visit = (await res.json()) as { referral_code: string; link_code: string; destination_id: string | null };
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: visit.destination_id ? `/explore/${visit.destination_id}` : "/" },
  });

  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    domain: REF_COOKIE_DOMAIN,
  };
  response.cookies.set(VISITOR_COOKIE, visitor, { ...base, maxAge: REF_MAX_AGE });
  // First touch wins: a later link doesn't replace the creator who brought them first, and the
  // link is remembered only together with that creator so the two can never disagree.
  if (!request.cookies.has(REF_COOKIE)) {
    response.cookies.set(REF_COOKIE, visit.referral_code, { ...base, maxAge: REF_MAX_AGE });
    response.cookies.set(LINK_COOKIE, visit.link_code, { ...base, maxAge: REF_MAX_AGE });
  }
  return response;
}
