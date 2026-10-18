import { NextResponse, type NextRequest } from "next/server";

import { clearSessionCookies } from "@/lib/server/session";
import { safeRedirect } from "@/lib/server/sso";

/** Central sign-out: clears the shared session cookie for every app, then returns the user
 *  where they asked (GET for links, POST for programmatic use). */
function signOut(request: NextRequest) {
  const target = safeRedirect(request.nextUrl.searchParams.get("redirect"));
  const response = NextResponse.redirect(target);
  clearSessionCookies(response);
  return response;
}

export const GET = signOut;

export function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  // Keep it usable from fetch() too; the client can navigate afterwards.
  void request;
  return response;
}
