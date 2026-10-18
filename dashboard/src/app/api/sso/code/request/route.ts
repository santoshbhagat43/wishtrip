import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL } from "@/lib/server/session";
import { SSO_URL } from "@/lib/server/sso";

/** A creator asks for a one-time sign-in code by email or WhatsApp. The backend always answers
 *  the same way, so this never reveals whether an address belongs to a creator. */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  const fields = (
    isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json()
  ) as Record<string, string | undefined>;
  const channel = fields.channel === "whatsapp" ? "whatsapp" : "email";

  const res = await fetch(`${BACKEND_URL}/auth/creator/request-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(channel === "whatsapp" ? { channel, phone: fields.phone } : { channel, email: fields.email }),
    cache: "no-store",
  });
  const ok = res.status === 202;

  if (isForm) {
    // Back to the code step (or the address step with a message), without the address in a
    // query string for anything but the step the creator is on.
    const next = new URL(`${SSO_URL || request.nextUrl.origin}/sso/login`);
    next.searchParams.set("for", "creator");
    next.searchParams.set("channel", channel);
    if (ok) next.searchParams.set("sent", channel === "whatsapp" ? (fields.phone ?? "") : (fields.email ?? ""));
    else next.searchParams.set("error", "code_address");
    if (fields.redirect) next.searchParams.set("redirect", fields.redirect);
    return NextResponse.redirect(next, 303);
  }
  if (!ok) {
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ detail: body.detail ?? "Couldn't send a code" }, { status: res.status });
  }
  return NextResponse.json({ sent: true }, { status: 202 });
}
