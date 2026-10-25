import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreatorProfileScreen } from "@/components/b4/screens/creator-profile";
import { fetchCreator } from "@/lib/server/creators";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const data = await fetchCreator(decodeURIComponent(handle));
  return data
    ? { title: `${data.creator.display_name} — wishtrip creator`, description: `Trips by ${data.creator.display_name} (@${data.creator.handle}) on wishtrip.` }
    : { title: "Creator — wishtrip" };
}

/** Served at /creator/<handle> (the proxy rewrites it here). */
export default async function Page({ params }: Props) {
  const { handle } = await params;
  const data = await fetchCreator(decodeURIComponent(handle));
  if (!data) notFound();
  return <CreatorProfileScreen data={data} />;
}
