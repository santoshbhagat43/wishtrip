"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { api, unwrap } from "@/lib/api/client";
import { useMe, useSignOut } from "@/lib/session";

/** A creator's home: their approval state, then (later) their reels and earnings. */
export default function CreatorPage() {
  const signOut = useSignOut();
  const me = useMe();
  const creator = useQuery({
    queryKey: ["creator-me"],
    retry: false,
    enabled: me.data?.role === "creator",
    queryFn: async () => {
      const r = await api.GET("/creators/me");
      return r.response.status === 404 ? null : unwrap(r);
    },
  });

  if (me.isLoading) return <Shell><p className="text-muted">Loading…</p></Shell>;

  if (!me.data) {
    return (
      <Shell>
        <h1 className="text-[28px] leading-tight">Creator sign in</h1>
        <p className="mt-2 text-muted">Sign in to see your creator account.</p>
        <Link href="/login" className="mt-5 inline-block"><Button>Go to sign in</Button></Link>
      </Shell>
    );
  }
  if (me.data.role !== "creator") {
    return (
      <Shell>
        <h1 className="text-[28px] leading-tight">This is the creator area</h1>
        <p className="mt-2 text-muted">You&rsquo;re signed in as a traveller. Plan your own trips instead.</p>
        <Link href="/plan" className="mt-5 inline-block"><Button>Plan a trip</Button></Link>
      </Shell>
    );
  }

  const status = creator.data?.status;
  const approved = status === "active";

  return (
    <Shell>
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${approved ? "bg-ok-soft text-ok" : status === "paused" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}>
        <span className={`size-2 rounded-full ${approved ? "bg-ok" : status === "paused" ? "bg-danger" : "bg-warn"}`} />
        {approved ? "Approved creator" : status === "paused" ? "Paused" : "Waiting for approval"}
      </span>

      {approved ? (
        <>
          <h1 className="mt-4 text-[32px] leading-tight">You’re in{creator.data?.display_name ? `, ${creator.data.display_name}` : ""} 🎉</h1>
          <p className="mt-2 text-muted">Your creator account is approved. Posting your reels and tracking what you earn is coming here next.</p>
        </>
      ) : status === "paused" ? (
        <>
          <h1 className="mt-4 text-[32px] leading-tight">Your creator account is paused</h1>
          <p className="mt-2 text-muted">Reach out to the wishtrip team to get it active again.</p>
        </>
      ) : (
        <>
          <h1 className="mt-4 text-[32px] leading-tight">Thanks — you’re on the list</h1>
          <p className="mt-2 text-muted">
            Your creator account{me.data.email ? ` (${me.data.email})` : ""} is waiting for the wishtrip team to approve it.
            We’ll email you the moment you’re in. You can close this page.
          </p>
        </>
      )}

      <button onClick={signOut} className="mt-8 text-sm text-muted hover:text-text">Sign out</button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg px-4 py-16">{children}</div>;
}
