import { NextResponse, type NextRequest } from "next/server";

import { REFRESH_COOKIE } from "@/lib/server/session";

const PRIVATE = ["/plan", "/profile", "/saved"];

/** Signed-in pages send visitors to /login; landing and explore stay public. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(REFRESH_COOKIE);
  if (!signedIn && PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/plan", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|media|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
