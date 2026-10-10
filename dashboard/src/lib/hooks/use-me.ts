"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: async () => unwrap(await api.GET("/auth/me")) });
}
