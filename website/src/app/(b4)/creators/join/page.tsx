import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { creatorSsoUrl } from "@/lib/server/sso";

/** Creator sign-in now happens on the shared SSO app (one-time code or Google). This keeps old
 *  "/creators/join" links working; the proxy normally redirects before this renders. */
export default async function CreatorJoinPage() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  redirect(creatorSsoUrl(host ? `${proto}://${host}/` : "/"));
}
