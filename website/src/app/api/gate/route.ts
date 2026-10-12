import { NextResponse, type NextRequest } from "next/server";

import { GATE_COOKIE, GATE_DAYS, gateToken, safeNext, sameText } from "@/lib/server/gate";

/** The /gate form posts here; a correct username and password set the gate cookie. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const user = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));

  const ok =
    sameText(user, process.env.SITE_USER ?? "") && sameText(password, process.env.SITE_PASSWORD ?? "");
  if (!ok) {
    return seeOther(`/gate?error=1&next=${encodeURIComponent(next)}`);
  }
  const response = seeOther(next);
  response.cookies.set(GATE_COOKIE, await gateToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * GATE_DAYS,
  });
  return response;
}

/**
 * Redirect with a relative Location. Behind the proxy, request.url is the container's own
 * address (http://0.0.0.0:3000), so an absolute URL built from it sends people there; the
 * browser resolves a relative one against the address it actually used.
 */
function seeOther(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
