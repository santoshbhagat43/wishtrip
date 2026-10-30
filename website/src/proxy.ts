import { NextResponse, type NextRequest } from "next/server";

import { GATE_COOKIE, gateEnabled, gateToken } from "@/lib/server/gate";
import { REFRESH_COOKIE } from "@/lib/server/session";
import { CREATOR_URL, publicOrigin, ssoLoginUrl } from "@/lib/server/sso";

const PRIVATE = ["/arya", "/profile", "/saved", "/help", "/creator"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The creator portal is its own app on the creator site, with no "/creator" in its addresses:
 *  the dashboard is "/", an itinerary is "/<id>" and the trip editor is "/trips/<id>". Old portal
 *  addresses on this site (bookmarks, emails) are sent there. */
const PORTAL_OUT = [
  [/^\/creator$/, "/"],
  [/^\/creator\/profile$/, "/profile"],
  [new RegExp(`^/creator/(${UUID})$`, "i"), "/$1"],
  [new RegExp(`^/creator/trips/(${UUID})$`, "i"), "/trips/$1"],
] as const;
/** The clean creator-site address for an in-app portal path, or null when it isn't one. */
function cleanPortalPath(pathname: string): string | null {
  for (const [from, to] of PORTAL_OUT) if (from.test(pathname)) return pathname.replace(from, to);
  return null;
}

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

  // The creator site is its own app: a request for it that reaches this one (an old address, a
  // misrouted host) goes there. None of the traveller website's pages answer on the creator domain.
  // (Never when this is the creator site's own host, which would send it back here in a loop.)
  const host = request.headers.get("host") ?? "";
  if (CREATOR_URL && host.startsWith("creator.") && host !== new URL(CREATOR_URL).host) {
    return NextResponse.redirect(new URL(`${cleanPortalPath(pathname) ?? pathname}${request.nextUrl.search}`, CREATOR_URL));
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) return NextResponse.next();

  // Arya moved from /plan to /arya: old links, bookmarks and prompts keep working.
  if (pathname === "/plan") {
    return NextResponse.redirect(new URL(`/arya${request.nextUrl.search}`, request.url), 308);
  }

  // A creator's public page, /creator/<handle>, is served from /creators/p/<handle>. A UUID there
  // is the creator portal's own itinerary page and is left alone.
  const publicCreator = pathname.match(/^\/creator\/([^/]+)$/);
  if (publicCreator && publicCreator[1] !== "profile" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicCreator[1])) {
    return NextResponse.rewrite(new URL(`/creators/p/${publicCreator[1]}`, request.url));
  }

  const signedIn = request.cookies.has(REFRESH_COOKIE);
  const isPortal = pathname === "/creator" || pathname.startsWith("/creator/");
  const search = request.nextUrl.search;

  // --- Traveller website ---
  // The creator portal and its sign-in live on the creator site.
  if (CREATOR_URL && (isPortal || pathname === "/creators/join")) {
    return NextResponse.redirect(new URL(`${pathname === "/creator" ? pathname : (cleanPortalPath(pathname) ?? pathname)}${search}`, CREATOR_URL));
  }

  // Signed-in pages send visitors to the shared SSO login; landing and explore stay public.
  if (!signedIn && PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const here = `${publicOrigin(request)}${pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(ssoLoginUrl(here));
  }
  if (signedIn && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/arya", request.url));
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
