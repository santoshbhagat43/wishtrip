"use client";

import createClient from "openapi-fetch";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { paths } from "@/lib/api/schema";

type Acting = {
  /** The creator staff are working for. */
  creatorId: string;
  /** The API client: every call carries X-Act-As-Creator, so the backend does the work in the
   *  creator's workspace exactly as if they had done it (and records that staff did). */
  api: ReturnType<typeof createClient<paths>>;
  /** Cache key for this creator's reel links. */
  linksKey: readonly unknown[];
  /** Header for raw fetches (the video upload). */
  actAs: Record<string, string>;
};

const Context = createContext<Acting | null>(null);

export function ActingProvider({ creatorId, children }: { creatorId: string; children: ReactNode }) {
  const value = useMemo<Acting>(
    () => ({
      creatorId,
      api: createClient<paths>({ baseUrl: "/api/backend", headers: { "x-act-as-creator": creatorId } }),
      linksKey: ["creator-links", creatorId],
      actAs: { "x-act-as-creator": creatorId },
    }),
    [creatorId],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useActing(): Acting {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useActing needs an ActingProvider");
  return ctx;
}
