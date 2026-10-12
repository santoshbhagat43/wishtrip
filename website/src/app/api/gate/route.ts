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
    const back = new URL("/gate", request.url);
    back.searchParams.set("error", "1");
    back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(GATE_COOKIE, await gateToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * GATE_DAYS,
  });
  return response;
}
