import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ssoLoginUrl } from "@/lib/server/sso";

/** Staff login now lives on the SSO app. Keep this path working by bouncing to it, returning the
 *  user to the dashboard afterwards. (The middleware normally sends people straight to SSO.) */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const path = next && next.startsWith("/") ? next : "/";
  const back = host ? `${proto}://${host}${path}` : "/";
  redirect(ssoLoginUrl(back));
}
