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
  const path = next && next.startsWith("/") ? next : "/arya";
  redirect(ssoLoginUrl(host ? `${proto}://${host}${path}` : "/arya"));
}
