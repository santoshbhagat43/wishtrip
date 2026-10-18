import type { NextRequest } from "next/server";

/** The website's creator-referral cookies (same names as website/src/lib/server/referral.ts).
 *  They live on the parent domain, so the SSO app — where people sign up — can read them. */
const REF_COOKIE = "wishtrip_ref";
const VISITOR_COOKIE = "wishtrip_visitor";

/** Which creator's link brought this visitor, for crediting a new sign-up. */
export function referralFrom(request: NextRequest): { referral_code: string | null; visitor_id: string } {
  return {
    referral_code: request.cookies.get(REF_COOKIE)?.value ?? null,
    visitor_id: request.cookies.get(VISITOR_COOKIE)?.value ?? "",
  };
}
