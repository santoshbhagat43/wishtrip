"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { api, unwrap } from "@/lib/api/client";

/** Current traveler, or null when signed out (no error noise on public pages). */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    retry: false,
    queryFn: async () => {
      const result = await api.GET("/auth/me");
      return result.response.status === 401 ? null : unwrap(result);
    },
  });
}

export async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Something went wrong");
  return data;
}

export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    router.replace("/");
    router.refresh();
  };
}
