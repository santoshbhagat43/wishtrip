import { NextResponse, type NextRequest } from "next/server";

import { GATE_COOKIE, gateEnabled, gateToken } from "@/lib/server/gate";
import { REFRESH_COOKIE } from "@/lib/server/session";

const PRIVATE = ["/plan", "/profile", "/saved", "/help", "/creator"];
// Reachable without the site password: the gate itself.
const GATE_PATHS = ["/gate", "/api/gate"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // While the site is private, everything — pages and API — needs the gate cookie.
  if (gateEnabled() && !GATE_PATHS.includes(pathname)) {
    const cookie = request.cookies.get(GATE_COOKIE)?.value ?? "";
    if (cookie !== (await gateToken())) {
      if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
        // 403, not 401: a 401 makes browsers treat it as a login challenge.
        return NextResponse.json({ detail: "This site is private." }, { status: 403 });
      }
      const url = new URL("/gate", request.url);
      url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) return NextResponse.next();

  // Signed-in pages send visitors to /login; landing and explore stay public.
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
  // Skipped: Next's build files, the image optimizer (it fetches files without the visitor's
  // cookie), the site's own design images in public/, and the reel-upload route (middleware
  // clones the body and would cap a video at 10MB; the backend still requires auth). /media —
  // place photos and reel covers from the backend — always goes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/reel-upload|(?!media/)[^?]*\\.(?:png|jpg|webp|mp4|svg|ico|woff2?)$).*)"],
};
