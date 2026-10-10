import { NextResponse, type NextRequest } from "next/server";

import { REFRESH_COOKIE } from "@/lib/server/session";

/** Send signed-out visitors to /login. Real authorization happens in the backend. */
export function proxy(request: NextRequest) {
  const signedIn = request.cookies.has(REFRESH_COOKIE);
  const onLogin = request.nextUrl.pathname === "/login";
  if (!signedIn && !onLogin) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && onLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
