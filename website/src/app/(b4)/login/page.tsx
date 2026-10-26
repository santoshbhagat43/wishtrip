import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ssoLoginUrl } from "@/lib/server/sso";

/** Login now happens on the shared SSO app; bounce there and return to where the visitor was. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  // Back to where the visitor was: the page they asked to sign in from, else the home page.
  let path = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
  if (!path) {
    try {
      const from = new URL(h.get("referer") ?? "");
      const here = from.pathname + from.search;
      path = from.host === host && !from.pathname.startsWith("/login") ? here : "/";
    } catch {
      path = "/";
    }
  }
  redirect(ssoLoginUrl(host ? `${proto}://${host}${path}` : "/"));
}
