import { NextResponse, type NextRequest } from "next/server";

import { GATE_COOKIE, gateEnabled, gateToken } from "@/lib/server/gate";
import { ACCESS_COOKIE, REFRESH_COOKIE, roleFromToken } from "@/lib/server/session";
import { SITE_URL, creatorSsoUrl, publicOrigin } from "@/lib/server/sso";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Reachable without the site password: the gate itself.
const GATE_PATHS = ["/gate", "/api/gate"];
/** The creator site's own pages: the dashboard, an itinerary, the trip editor and the profile. */
const PAGES = [/^\/$/, new RegExp(`^/${UUID}$`, "i"), new RegExp(`^/trips/${UUID}$`, "i"), /^\/profile$/];
/** Addresses from when the portal lived under /creator on the website: old links and emails. */
const OLD = [
  [/^\/creator$/, "/"],
  [/^\/creator\/profile$/, "/profile"],
  [new RegExp(`^/creator/(${UUID})$`, "i"), "/$1"],
  [new RegExp(`^/creator/trips/(${UUID})$`, "i"), "/trips/$1"],
] as const;

/** The creator site. Only its own pages exist here: anything of the traveller website (a trip, Arya,
 *  a destination) is the website's, so it is sent there, never served from this domain. */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // While the site is private, everything — pages and API — needs the gate cookie.
  if (gateEnabled() && !GATE_PATHS.includes(pathname)) {
    const cookie = request.cookies.get(GATE_COOKIE)?.value ?? "";
    if (cookie !== (await gateToken())) {
      if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
        // 403, not 401: a 401 makes browsers treat it as a login challenge.
        return NextResponse.json({ detail: "This site is private." }, { status: 403 });
      }
      const url = new URL("/gate", request.url);
      url.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/media/") || GATE_PATHS.includes(pathname)) return NextResponse.next();

  const origin = publicOrigin(request);
  const signedIn = request.cookies.has(REFRESH_COOKIE);
  // The old dashboard address sends a visitor who isn't signed in straight to sign-in, as it always did.
  if (pathname === "/creator" && !signedIn) return NextResponse.redirect(creatorSsoUrl(`${origin}/`));
  for (const [from, to] of OLD) {
    if (from.test(pathname)) return NextResponse.redirect(new URL(`${pathname.replace(from, to)}${search}`, request.url), 308);
  }

  // Every way in to signing in goes to SSO, opened on creator sign-in.
  if (pathname === "/login" || pathname === "/signup" || pathname === "/creators/join") {
    return NextResponse.redirect(creatorSsoUrl(`${origin}/`));
  }
  if (PAGES.some((p) => p.test(pathname))) {
    if (pathname === "/") {
      // Signed-in creators see their dashboard; everyone else sees the creator programme.
      const role = roleFromToken(request.cookies.get(ACCESS_COOKIE)?.value);
      if (signedIn && (role === "creator" || role === null)) return NextResponse.next();
      if (signedIn || !SITE_URL) return NextResponse.redirect(creatorSsoUrl(`${origin}/`));
      return NextResponse.redirect(new URL("/creators", SITE_URL));
    }
    if (!signedIn) return NextResponse.redirect(creatorSsoUrl(`${origin}${pathname}${search}`));
    return NextResponse.next();
  }
  // The creator programme and everything else a traveller sees lives on the website.
  if (SITE_URL) return NextResponse.redirect(new URL(`${pathname}${search}`, SITE_URL));
  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  // Skipped: Next's build files, the image optimizer, the site's own images in public/, and the
  // reel-upload route (middleware clones the body and would cap a video at 10MB; the backend still
  // requires auth). /media — reel covers from the backend — always goes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/reel-upload|(?!media/)[^?]*\\.(?:png|jpg|webp|mp4|svg|ico|woff2?)$).*)"],
};
