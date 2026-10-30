"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { SheetFor } from "@/components/creator/reel-links";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/card";
import { api, unwrap } from "@/lib/api/client";

/** One itinerary on its own address, /<itinerary id> on the creator site: reloading keeps you here, the
 *  browser's Back button returns to the dashboard, and the link can be bookmarked. */
export default function ItineraryPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const links = useQuery({
    queryKey: ["creator-links"],
    queryFn: async () => unwrap(await api.GET("/creator/links")),
    // While the reel is still being read, keep checking how far it got.
    refetchInterval: (query) => (query.state.data?.some((l) => l.status === "building") ? 1500 : false),
  });

  if (links.isLoading) return <Spinner />;
  const link = links.data?.find((l) => l.trip_id === tripId);
  if (!link) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-[28px] leading-tight">We couldn&rsquo;t find that itinerary</h1>
        <p className="mt-2 text-muted">It may belong to another creator account, or it was removed.</p>
        <div className="mt-5 flex justify-center">
          <Link href="/">
            <Button variant="secondary">Back to your dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }
  return <SheetFor link={link} onClose={() => router.push(`/?reel=${link.id}`)} />;
}
