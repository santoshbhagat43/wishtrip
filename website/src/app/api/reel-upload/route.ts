import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  BACKEND_URL,
  REFRESH_COOKIE,
  refreshTokens,
  setSessionCookies,
  type TokenPair,
} from "@/lib/server/session";

// A reel video is larger than the default request-body limit, so stream the raw video bytes
// straight to the backend instead of buffering/parsing them here.
export const runtime = "nodejs";

/** Forward an uploaded reel video (raw body) to the backend with the traveller's token.
 *  The /api/wt gateway only forwards JSON, so uploads get their own streaming route. */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("video/")) {
    return NextResponse.json({ detail: "Choose a video to upload." }, { status: 400 });
  }

  // Refresh up front when the access cookie is gone — the body stream can only be sent once.
  let refreshed: TokenPair | null = null;
  let token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token && request.cookies.has(REFRESH_COOKIE)) {
    refreshed = await refreshTokens(request.cookies.get(REFRESH_COOKIE)!.value);
    token = refreshed?.access_token;
  }

  const upstream = await fetch(`${BACKEND_URL}/reels/uploads`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-reel-filename": request.headers.get("x-reel-filename") ?? "upload.mp4",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
