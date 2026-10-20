import { NextResponse, type NextRequest } from "next/server";

import { referralFrom } from "@/lib/server/referral";
import { BACKEND_URL, setSharedSessionCookies, type TokenPair } from "@/lib/server/session";
import { SSO_URL, safeRedirect } from "@/lib/server/sso";

/** Someone enters their one-time code: on success, the shared SSO session is minted and they go
 *  back to the site they came from. A traveller (the default) signs in or up, credited to the
 *  creator whose link brought them; `for=creator` signs a creator in. JSON from the page's
 *  script, or a native form post (303). */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  const fields = (
    isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json()
  ) as Record<string, string | undefined>;
  const creator = fields.for === "creator";
  const channel = creator && fields.channel === "whatsapp" ? "whatsapp" : "email";
  const address = channel === "whatsapp" ? { phone: fields.phone } : { email: fields.email };

  const res = await fetch(`${BACKEND_URL}${creator ? "/auth/creator/verify" : "/auth/otp/verify"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      creator ? { channel, ...address, code: fields.code } : { ...address, code: fields.code, ...referralFrom(request) },
    ),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (isForm) {
      const retry = new URL(`${SSO_URL || request.nextUrl.origin}/sso/login`);
      if (creator) retry.searchParams.set("for", "creator");
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
