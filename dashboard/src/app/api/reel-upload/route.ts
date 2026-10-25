import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, BACKEND_URL, REFRESH_COOKIE, refreshTokens, setSessionCookies, type TokenPair } from "@/lib/server/session";

// A reel video is larger than the default request-body limit, so stream the raw video bytes
// straight to the backend instead of buffering/parsing them here.
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/;

/** Forward a video staff upload for one of a creator's reel links (?link=<id>), working as that
 *  creator (X-Act-As-Creator). The generic /api/backend pass-through buffers bodies, which is
 *  fine for forms but not for a video. */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const link = request.nextUrl.searchParams.get("link") ?? "";
  const creator = request.headers.get("x-act-as-creator") ?? "";
  if (!contentType.startsWith("video/")) {
    return NextResponse.json({ detail: "Choose a video to upload." }, { status: 400 });
  }
  if (!UUID.test(link) || !UUID.test(creator)) {
    return NextResponse.json({ detail: "That link isn't valid." }, { status: 400 });
  }

  // Refresh up front when the access cookie is gone: the body stream can only be sent once.
  let refreshed: TokenPair | null = null;
  let token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token && request.cookies.has(REFRESH_COOKIE)) {
    refreshed = await refreshTokens(request.cookies.get(REFRESH_COOKIE)!.value);
    token = refreshed?.access_token;
  }
  if (!token) return NextResponse.json({ detail: "Sign in again." }, { status: 401 });

  const upstream = await fetch(`${BACKEND_URL}/creator/links/${link}/upload`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-reel-filename": request.headers.get("x-reel-filename") ?? "upload.mp4",
      "x-act-as-creator": creator,
      authorization: `Bearer ${token}`,
    },
    body: request.body,
    // @ts-expect-error -- Node fetch needs duplex to stream a request body.
    duplex: "half",
    cache: "no-store",
  });

  const data = await upstream.json().catch(() => ({ detail: "Upload failed" }));
  const response = NextResponse.json(data, { status: upstream.status });
  if (refreshed) setSessionCookies(response, refreshed);
  return response;
}
