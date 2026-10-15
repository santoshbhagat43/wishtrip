import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  BACKEND_URL,
  REFRESH_COOKIE,
  refreshTokens,
  setSessionCookies,
  type TokenPair,
} from "@/lib/server/session";

/** Forward an uploaded reel video (multipart) to the backend with the traveller's token.
 *  The /api/wt gateway only forwards JSON, so uploads get their own route. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ detail: "Choose a video to upload." }, { status: 400 });
  }
  const send = (token: string | undefined) => {
    const body = new FormData();
    body.append("file", file, file.name);
    return fetch(`${BACKEND_URL}/reels/uploads`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
      cache: "no-store",
    });
  };

  let refreshed: TokenPair | null = null;
  let upstream = await send(request.cookies.get(ACCESS_COOKIE)?.value);
  if (upstream.status === 401 && request.cookies.has(REFRESH_COOKIE)) {
    refreshed = await refreshTokens(request.cookies.get(REFRESH_COOKIE)!.value);
    if (refreshed) upstream = await send(refreshed.access_token);
  }
  const data = await upstream.json().catch(() => ({ detail: "Upload failed" }));
  const response = NextResponse.json(data, { status: upstream.status });
  if (refreshed) setSessionCookies(response, refreshed);
  return response;
}
