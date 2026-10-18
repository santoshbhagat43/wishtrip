import { NextResponse, type NextRequest } from "next/server";

import { referralFrom } from "@/lib/server/referral";
import { BACKEND_URL, setSharedSessionCookies, type TokenPair } from "@/lib/server/session";
import { SSO_URL, safeRedirect } from "@/lib/server/sso";

/** Email sign-up on the shared SSO app. Creates a traveller account (crediting the creator whose
 *  link brought them, if any), signs them in with the shared session, and sends them back.
 *
 *  Like /api/sso/login: JSON from the page's script, or the form posted natively before the page
 *  hydrates (then answered with a 303, never putting the password in a URL). */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  const fields = (
    isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json()
  ) as Record<string, string | undefined>;

  const res = await fetch(`${BACKEND_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      full_name: fields.full_name ?? "",
      email: fields.email,
      password: fields.password,
      ...referralFrom(request),
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (isForm) {
      const retry = new URL(`${SSO_URL || request.nextUrl.origin}/sso/login`);
      retry.searchParams.set("mode", "signup");
      retry.searchParams.set("error", res.status === 409 ? "email_taken" : "signup_invalid");
      if (fields.redirect) retry.searchParams.set("redirect", fields.redirect);
      return NextResponse.redirect(retry, 303);
    }
    return NextResponse.json({ detail: body.detail ?? "Sign-up failed" }, { status: res.status });
  }

  const destination = safeRedirect(fields.redirect);
  const response = isForm
    ? NextResponse.redirect(destination, 303)
    : NextResponse.json({ ok: true, redirect: destination }, { status: 201 });
  setSharedSessionCookies(response, body as TokenPair);
  return response;
}
