import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSharedSessionCookies, type TokenPair } from "@/lib/server/session";
import { SSO_URL, safeRedirect } from "@/lib/server/sso";

/** A creator enters their one-time code: on success, the shared SSO session is minted and they
 *  go back to the creator site. JSON from the page's script, or a native form post (303). */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  const fields = (
    isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json()
  ) as Record<string, string | undefined>;
  const channel = fields.channel === "whatsapp" ? "whatsapp" : "email";
  const address = channel === "whatsapp" ? { phone: fields.phone } : { email: fields.email };

  const res = await fetch(`${BACKEND_URL}/auth/creator/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel, ...address, code: fields.code }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (isForm) {
      const retry = new URL(`${SSO_URL || request.nextUrl.origin}/sso/login`);
      retry.searchParams.set("for", "creator");
      retry.searchParams.set("channel", channel);
      retry.searchParams.set("sent", (channel === "whatsapp" ? fields.phone : fields.email) ?? "");
      retry.searchParams.set("error", "code_wrong");
      if (fields.redirect) retry.searchParams.set("redirect", fields.redirect);
      return NextResponse.redirect(retry, 303);
    }
    return NextResponse.json({ detail: body.detail ?? "That code didn't work" }, { status: res.status });
  }

  const destination = safeRedirect(fields.redirect);
  const response = isForm
    ? NextResponse.redirect(destination, 303)
    : NextResponse.json({ ok: true, redirect: destination });
  setSharedSessionCookies(response, body as TokenPair);
  return response;
}
