import { NextResponse, type NextRequest } from "next/server";

import { BACKEND_URL } from "@/lib/server/session";

/** Creator sign-in step 1: ask the backend to email a 4-digit code. */
export async function POST(request: NextRequest) {
  const res = await fetch(`${BACKEND_URL}/auth/creator/request-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ detail: body.detail ?? "Couldn't send the code" }, { status: res.status });
  return NextResponse.json({ ok: true });
}
