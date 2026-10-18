import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, REFRESH_COOKIE, roleFromToken } from "@/lib/server/session";
import { isSsoHost } from "@/lib/server/sso";

// Who may use the admin dashboard. Everyone else uses SSO and the website / creator site.
const STAFF_ROLES = new Set(["admin", "editor", "support"]);

/**
 * One app, two hosts:
 *  - the SSO host (sso.<domain>) serves only the /sso/* login, for travellers and creators;
 *  - the admin dashboard host has its own /login and its own session. The shared SSO cookie is
 *    never read here, so signing in on SSO grants nothing in the admin dashboard.
 * Real authorization still happens in the backend on every call.
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

  // --- Admin dashboard host ---
  // The /sso pages belong to the SSO host only.
  if (pathname.startsWith("/sso")) return NextResponse.redirect(new URL("/", request.url));

  // No role yet means the short-lived access token expired; the refresh cookie is still valid,
  // so let the page load and the API gateway refresh it. A known non-staff role is turned away.
  const role = roleFromToken(request.cookies.get(ACCESS_COOKIE)?.value);
  const signedIn = request.cookies.has(REFRESH_COOKIE) && (role === null || STAFF_ROLES.has(role));

  if (pathname === "/login") {
    return signedIn ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (!signedIn) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
