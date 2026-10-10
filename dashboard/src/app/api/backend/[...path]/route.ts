import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  BACKEND_URL,
  REFRESH_COOKIE,
  clearSessionCookies,
  refreshTokens,
  setSessionCookies,
  type TokenPair,
} from "@/lib/server/session";

/**
 * Authenticated pass-through to the FastAPI backend. Adds the bearer token from the httpOnly
 * cookie, and on a 401 refreshes once and retries, so pages never handle tokens themselves.
 */
async function forward(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${BACKEND_URL}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  // Buffer the body once so it can be replayed after a token refresh (uploads are small).
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();

  const send = (token: string | undefined) => {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(target, { method: request.method, headers, body, cache: "no-store" });
  };

  let refreshed: TokenPair | null = null;
  let upstream = await send(request.cookies.get(ACCESS_COOKIE)?.value);
  if (upstream.status === 401) {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    refreshed = refreshToken ? await refreshTokens(refreshToken) : null;
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

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
