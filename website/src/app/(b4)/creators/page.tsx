import type { Metadata } from "next";
import { headers } from "next/headers";

import { CreatorsScreen } from "@/components/b4/screens/creators";
import { CREATOR_URL, creatorSsoUrl } from "@/lib/server/sso";

export const metadata: Metadata = { title: "For creators — wishtrip" };

/** Rendered per request: the SSO address is runtime configuration, not known at build time. */
export default async function Page() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  // Where a creator lands after signing in: their dashboard on the creator site.
  const dashboard = CREATOR_URL ? `${CREATOR_URL}/creator` : `${proto}://${host}/creator`;
  return <CreatorsScreen signInHref={creatorSsoUrl(dashboard)} />;
}
