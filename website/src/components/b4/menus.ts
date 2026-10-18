"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type Menu = Schemas["PublicMenu"];
export type MenuLink = Schemas["PublicMenuItem"];

/** CMS-managed navigation for a placement (header / footer / mobile). Cached for a few minutes. */
export function useMenus(placement: "header" | "footer" | "mobile") {
  return useQuery({
    queryKey: ["menus", placement],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await api.GET("/explore/menus", { params: { query: { placement } } })),
  });
}

export const menuBySlug = (menus: Menu[] | undefined, slug: string) =>
  menus?.find((m) => m.slug === slug);

/** Footer groups the B4 design owns (slug prefix), in order. */
export const b4FooterGroups = (menus: Menu[] | undefined) =>
  (menus ?? []).filter((m) => m.slug.startsWith("b4-footer"));
