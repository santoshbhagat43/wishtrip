import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ssoLoginUrl } from "@/lib/server/sso";

/** Sign-up is handled on the shared SSO app (Continue with Google creates an account). */
export default async function SignupPage() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  redirect(ssoLoginUrl(host ? `${proto}://${host}/plan` : "/plan"));
}
