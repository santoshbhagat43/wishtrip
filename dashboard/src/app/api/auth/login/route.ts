import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL, setSessionCookies, type TokenPair } from "@/lib/server/session";
import { publicOrigin } from "@/lib/server/sso";

/** Who may sign in to the admin dashboard. Travellers and creators use SSO and their own apps. */
const STAFF_ROLES = new Set(["admin", "editor", "support"]);
const NOT_STAFF = "The admin dashboard is for WishTrip staff. Traveller and creator accounts can't sign in here.";

/** Only same-site paths, so a crafted ?next= can't send a fresh session somewhere else. */
function safeNext(next: string | undefined, role: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && next !== "/") return next;
  return role === "support" ? "/support" : "/";
}

/**
 * Staff sign-in for the admin dashboard — its own session, separate from SSO.
 *
 * Two callers: the login page's script (JSON in, JSON out) and the same form posted natively
 * when the page hasn't hydrated yet (form fields in, 303 redirect out), so a password is never
 * put in a URL.
 */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  const fields = (
    isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json()
  ) as Record<string, string | undefined>;

  const fail = (detail: string, status: number) => {
    if (!isForm) return NextResponse.json({ detail }, { status });
    const retry = new URL("/login", publicOrigin(request));
    retry.searchParams.set("error", status === 403 ? "not_staff" : "invalid");
    if (fields.next) retry.searchParams.set("next", fields.next);
    return NextResponse.redirect(retry, 303);
  };

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fields.email, password: fields.password }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return fail(body.detail ?? "Sign-in failed", res.status);
  }
  const tokens = (await res.json()) as TokenPair;
  const me = await fetch(`${BACKEND_URL}/auth/me`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  }).then((r) => r.json());
  if (!STAFF_ROLES.has(me.role)) return fail(NOT_STAFF, 403);

  const response = isForm
    ? NextResponse.redirect(new URL(safeNext(fields.next, me.role), publicOrigin(request)), 303)
    : NextResponse.json({ ...me, next: safeNext(fields.next, me.role) });
  setSessionCookies(response, tokens);
  return response;
}
