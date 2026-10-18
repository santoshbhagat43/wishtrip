import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, REFRESH_COOKIE, roleFromToken } from "@/lib/server/session";
import { isSsoHost, publicOrigin, ssoLoginUrl } from "@/lib/server/sso";

// Who may use the staff dashboard. Travelers/creators share the same SSO session but are sent away.
const STAFF_ROLES = new Set(["admin", "editor", "support"]);

/**
 * One app, two hosts:
 *  - the SSO host (sso.<domain>) serves only the /sso/* login pages;
 *  - the dashboard host requires a signed-in staff session (minted by the SSO app) and sends
 *    everyone else to the SSO login. Real authorization still happens in the backend.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const { pathname } = request.nextUrl;

  if (isSsoHost(host)) {
    // The SSO host is just the login surface; keep it off the dashboard pages.
    if (!pathname.startsWith("/sso")) {
      return NextResponse.redirect(new URL("/sso/login", request.url));
    }
    return NextResponse.next();
  }

  // --- Staff dashboard host ---
  // The /sso pages belong to the SSO host only.
  if (pathname.startsWith("/sso")) return NextResponse.redirect(new URL("/", request.url));

  const here = `${publicOrigin(request)}${pathname}${request.nextUrl.search}`;
  const signedIn = request.cookies.has(REFRESH_COOKIE);
  if (!signedIn) {
    if (pathname === "/no-access") return NextResponse.next();
    return NextResponse.redirect(ssoLoginUrl(here));
  }

  // Signed in, but with a traveler/creator account — show "no access" (no redirect loop).
  const role = roleFromToken(request.cookies.get(ACCESS_COOKIE)?.value);
  if (role && !STAFF_ROLES.has(role)) {
    if (pathname === "/no-access") return NextResponse.next();
    return NextResponse.rewrite(new URL("/no-access", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
