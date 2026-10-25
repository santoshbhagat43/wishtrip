import { NextResponse, type NextRequest } from "next/server";

import { GATE_COOKIE, gateEnabled, gateToken } from "@/lib/server/gate";
import { ACCESS_COOKIE, REFRESH_COOKIE, roleFromToken } from "@/lib/server/session";
import { CREATOR_URL, SITE_URL, creatorSsoUrl, isCreatorHost, publicOrigin, ssoLoginUrl } from "@/lib/server/sso";

const PRIVATE = ["/arya", "/profile", "/saved", "/help", "/creator"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The creator site has no "/creator" in its addresses: the dashboard is "/", an itinerary is
 *  "/<id>" and the trip editor is "/trips/<id>". Inside the app those pages live under /creator,
 *  and the proxy maps between the two. */
const PORTAL_OUT = [
  [/^\/creator$/, "/"],
  [new RegExp(`^/creator/(${UUID})$`, "i"), "/$1"],
  [new RegExp(`^/creator/trips/(${UUID})$`, "i"), "/trips/$1"],
] as const;
const PORTAL_IN = [
  [/^\/profile$/, "/creator/profile"],
  [new RegExp(`^/(${UUID})$`, "i"), "/creator/$1"],
  [new RegExp(`^/trips/(${UUID})$`, "i"), "/creator/trips/$1"],
] as const;

/** The clean creator-site address for an in-app portal path, or null when it isn't one. */
function cleanPortalPath(pathname: string): string | null {
  for (const [from, to] of PORTAL_OUT) if (from.test(pathname)) return pathname.replace(from, to);
  return null;
}

/** The in-app path behind a clean creator-site address, or null. */
function portalTarget(pathname: string): string | null {
  for (const [from, to] of PORTAL_IN) if (from.test(pathname)) return pathname.replace(from, to);
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

  if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) return NextResponse.next();

  // Arya moved from /plan to /arya: old links, bookmarks and prompts keep working.
  if (pathname === "/plan") {
    return NextResponse.redirect(new URL(`/arya${request.nextUrl.search}`, request.url), 308);
  }

  // A creator's public page, /creator/<handle>, is served from /creators/p/<handle>. A UUID there
  // is the creator portal's own itinerary page and is left alone.
  const publicCreator = pathname.match(/^\/creator\/([^/]+)$/);
  if (publicCreator && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicCreator[1])) {
    return NextResponse.rewrite(new URL(`/creators/p/${publicCreator[1]}`, request.url));
  }

  const signedIn = request.cookies.has(REFRESH_COOKIE);
  const isPortal = pathname === "/creator" || pathname.startsWith("/creator/");
  const search = request.nextUrl.search;

  if (isCreatorHost(request.headers.get("host"))) {
    // --- Creator site (creator.<domain>), served by this same app ---
    const origin = publicOrigin(request);
    const portal = `${origin}/`;
    // The old /creator… addresses (bookmarks, emails) go to the clean ones. The old dashboard
    // address sends a visitor who isn't signed in straight to sign-in, as it always did.
    if (pathname === "/creator" && !signedIn) return NextResponse.redirect(creatorSsoUrl(portal));
    const clean = cleanPortalPath(pathname);
    if (clean !== null) return NextResponse.redirect(new URL(`${clean}${search}`, request.url), 308);
    // The creator programme (and its apply form) lives on the traveller website: someone who
    // isn't signed in is taken there. The #apply in the address survives the redirect.
    if (pathname === "/creators" && !signedIn && SITE_URL) {
      return NextResponse.redirect(new URL(`/creators${search}`, SITE_URL));
    }
    if (pathname === "/") {
      // Signed-in creators see their dashboard here; everyone else sees the creator programme.
      const role = roleFromToken(request.cookies.get(ACCESS_COOKIE)?.value);
      const creator = signedIn && (role === "creator" || role === null);
      if (creator) return NextResponse.rewrite(new URL("/creator", request.url));
      return NextResponse.redirect(new URL(`/creators`, SITE_URL || request.url));
    }
    const target = portalTarget(pathname);
    if (target !== null) {
      if (!signedIn) return NextResponse.redirect(creatorSsoUrl(`${origin}${pathname}${search}`));
      return NextResponse.rewrite(new URL(`${target}${search}`, request.url));
    }
    // Every way in to signing in goes to SSO, opened on creator sign-in.
    if (pathname === "/login" || pathname === "/signup" || pathname === "/creators/join") {
      return NextResponse.redirect(creatorSsoUrl(portal));
    }
    if (isPortal && !signedIn) return NextResponse.redirect(creatorSsoUrl(`${origin}${pathname}${search}`));
    return NextResponse.next();
  }

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
