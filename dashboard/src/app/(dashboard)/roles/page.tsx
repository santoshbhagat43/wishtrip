"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, ErrorNote, PageHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";

/**
 * The live rules, transcribed from the API's own guards:
 *   require_roles(ADMIN, EDITOR) on /admin/*, require_roles(ADMIN) on /admin/users*,
 *   get_current_user on the traveller routes.
 * This screen reports them; it is not a permissions store, and there isn't one yet.
 */
const ROLES = ["admin", "editor", "traveler"] as const;
type RoleName = (typeof ROLES)[number];

const ROLE_INFO: Record<RoleName, { label: string; description: string; system: boolean }> = {
  admin: { label: "Admin", description: "Everything, including staff accounts.", system: true },
  editor: { label: "Editor", description: "The knowledge base and the trip chat, but not staff accounts.", system: true },
  traveler: { label: "Traveller", description: "Their own profile, saved places and trips. No staff screens.", system: true },
};

const MATRIX: { group: string; rows: { label: string; note: string; allowed: RoleName[] }[] }[] = [
  {
    group: "Knowledge base",
    rows: [
      { label: "View locations, tags, hierarchy", note: "GET /admin/locations", allowed: ["admin", "editor"] },
      { label: "Create and edit records", note: "POST, PATCH /admin/locations", allowed: ["admin", "editor"] },
      { label: "Publish — makes a record live for travellers and the AI", note: "PATCH status", allowed: ["admin", "editor"] },
      { label: "Delete records", note: "DELETE /admin/locations", allowed: ["admin", "editor"] },
      { label: "Upload media", note: "POST /admin/locations/{id}/media", allowed: ["admin", "editor"] },
      { label: "Queue re-indexing", note: "POST /admin/locations/reindex", allowed: ["admin", "editor"] },
    ],
  },
  {
    group: "Review and intelligence",
    rows: [
      { label: "Work the review queue", note: "GET /admin/review-queue", allowed: ["admin", "editor"] },
      { label: "See destinations and system health", note: "GET /admin/destinations, /admin/system", allowed: ["admin", "editor"] },
      { label: "Inspect any traveller's profile", note: "GET /admin/travelers", allowed: ["admin", "editor"] },
      { label: "Preview recommendations for a traveller", note: "GET /admin/recommendations/preview", allowed: ["admin", "editor"] },
      { label: "Use the staff trip chat", note: "POST /chat/sessions", allowed: ["admin", "editor", "traveler"] },
    ],
  },
  {
    group: "Administration",
    rows: [
      { label: "List staff users", note: "GET /admin/users", allowed: ["admin"] },
      { label: "Create staff and change roles", note: "POST, PATCH /admin/users", allowed: ["admin"] },
      { label: "Read the audit log", note: "GET /admin/audit-log", allowed: ["admin", "editor"] },
    ],
  },
  {
    group: "Traveller side",
    rows: [
      { label: "Own profile and saved places", note: "GET, PUT /profiles/me", allowed: ["admin", "editor", "traveler"] },
      { label: "Own trips and chat", note: "/chat/*", allowed: ["admin", "editor", "traveler"] },
      { label: "Browse published places", note: "/explore/*", allowed: ["admin", "editor", "traveler"] },
    ],
  },
];

export default function RolesPage() {
  // One call per role, reading `total` — a page of users would miss anyone past the limit.
  const users = useQuery({
    queryKey: ["users", "role-counts"],
    queryFn: async () => {
      const pages = await Promise.all(
        ROLES.map(async (role) => [
          role,
          unwrap(await api.GET("/admin/users", { params: { query: { role, page_size: 1 } } })).total,
        ] as const),
      );
      return Object.fromEntries(pages) as Record<RoleName, number>;
    },
  });

  const counts = users.data ?? ({} as Record<RoleName, number>);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumb="Admin"
        title="Roles & permissions"
        description="What each role can do, read from the API's own guards. Change a person's role in Staff users."
      />

      {users.error && <ErrorNote error={users.error} />}

      <div className="grid gap-3 sm:grid-cols-3">
        {ROLES.map((role) => (
          <Card key={role} className="px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text">{ROLE_INFO[role].label}</h2>
              <Badge tone="neutral">System</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{ROLE_INFO[role].description}</p>
            <p className="mt-3 text-sm text-text">
              {users.isLoading ? "…" : `${counts[role] ?? 0} ${(counts[role] ?? 0) === 1 ? "account" : "accounts"}`}
            </p>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Permission matrix"
          description="Enforced in the API, not in the browser — a hidden menu is not a permission."
        />
        <Table>
          <thead>
            <tr>
              <Th>Capability</Th>
              {ROLES.map((role) => (
                <Th key={role} className="w-28 text-center">
                  {ROLE_INFO[role].label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((section) => (
              <Fragment key={section.group}>
                <tr>
                  <Td className="bg-surface-2 text-xs font-medium uppercase tracking-wide text-muted" >
                    {section.group}
                  </Td>
                  {ROLES.map((role) => (
                    <Td key={role} className="bg-surface-2" />
                  ))}
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.label} className="hover:bg-surface-2">
                    <Td>
                      <p className="text-text">{row.label}</p>
                      <p className="font-mono text-xs text-muted">{row.note}</p>
                    </Td>
                    {ROLES.map((role) => (
                      <Td key={role} className="text-center">
                        {row.allowed.includes(role) ? (
                          <Check className="mx-auto size-4 text-ok" />
                        ) : (
                          <Minus className="mx-auto size-4 text-muted/50" />
                        )}
                      </Td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      </Card>

      <p className="mt-4 text-sm text-muted">
        These three roles are fixed in code. Custom roles, per-destination scoping and a per-capability editor need a
        permissions table behind them — designed, not built.
      </p>
    </div>
  );
}
