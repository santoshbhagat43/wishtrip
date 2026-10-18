import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";
import { SSO_URL, safeRedirect } from "@/lib/server/sso";

/** Password sign-in for any wishtrip user. Mints the shared session cookie and sends the user
 *  back where they came from; role-based access is enforced by each destination app.
 *
 *  Two callers: the login page's script (JSON in, JSON out) and the same form posted natively
 *  when the page hasn't hydrated yet (form fields in, 303 redirect out). */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  const fields = isForm
    ? Object.fromEntries((await request.formData()).entries())
    : await request.json();
  const { email, password, redirect } = fields as Record<string, string | undefined>;

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (isForm) {
      // Back to the form with a message — never echo the credentials into the URL.
      const retry = new URL(`${SSO_URL || request.nextUrl.origin}/sso/login`);
      retry.searchParams.set("error", "invalid");
      if (redirect) retry.searchParams.set("redirect", redirect);
      return NextResponse.redirect(retry, 303);
    }
    return NextResponse.json({ detail: body.detail ?? "Sign-in failed" }, { status: res.status });
  }

  const destination = safeRedirect(redirect);
  const response = isForm
    ? NextResponse.redirect(destination, 303)
    : NextResponse.json({ ok: true, redirect: destination });
  setSessionCookies(response, body as TokenPair);
  return response;
}
