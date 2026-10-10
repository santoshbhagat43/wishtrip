import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  BACKEND_URL,
  REFRESH_COOKIE,
  clearSessionCookies,
  isAllowed,
  refreshTokens,
  setSessionCookies,
  type TokenPair,
} from "@/lib/server/session";

/**
 * Same-origin gateway: the browser calls /api/wt/..., this server adds the session token and
 * forwards allowlisted traveler routes to the backend. On a 401 it refreshes once and retries.
 */
async function gateway(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const route = path.join("/");
  if (!isAllowed(request.method, route)) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  const target = `${BACKEND_URL}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const body = ["GET", "HEAD", "DELETE"].includes(request.method) ? undefined : await request.text();

  const send = (token: string | undefined) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(target, { method: request.method, headers, body, cache: "no-store" });
  };

  let refreshed: TokenPair | null = null;
  let upstream = await send(request.cookies.get(ACCESS_COOKIE)?.value);
  if (upstream.status === 401 && request.cookies.has(REFRESH_COOKIE)) {
    refreshed = await refreshTokens(request.cookies.get(REFRESH_COOKIE)!.value);
    if (refreshed) upstream = await send(refreshed.access_token);
  }
  const response = new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
  if (refreshed) setSessionCookies(response, refreshed);
  else if (upstream.status === 401) clearSessionCookies(response);
  return response;
}

export { gateway as DELETE, gateway as GET, gateway as POST, gateway as PUT };
