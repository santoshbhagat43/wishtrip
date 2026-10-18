import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ssoLoginUrl } from "@/lib/server/sso";

/** Sign-up is handled on the shared SSO app, opened on its "Create account" form. */
export default async function SignupPage() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const url = new URL(ssoLoginUrl(host ? `${proto}://${host}/plan` : "/plan"));
  url.searchParams.set("mode", "signup");
  redirect(url.toString());
}
