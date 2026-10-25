import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ssoLoginUrl } from "@/lib/server/sso";

/** Sign-up is handled on the shared SSO app, opened on its sign-in form (an emailed code or Google; the first sign-in creates the account). */
export default async function SignupPage() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const url = new URL(ssoLoginUrl(host ? `${proto}://${host}/arya` : "/arya"));
  url.searchParams.set("mode", "signup");
  redirect(url.toString());
}
