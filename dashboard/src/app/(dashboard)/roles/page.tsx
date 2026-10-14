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
 *   require_staff (admin, editor) on KB writes,
 *   require_reader / require_support (admin, editor, support) on reads and inbox,
 *   require_roles(ADMIN) on /admin/users* and /admin/audit-log,
 *   get_current_user on the traveller routes.
 */
const ROLES = ["admin", "editor", "support", "traveler"] as const;
type RoleName = (typeof ROLES)[number];

const ROLE_INFO: Record<RoleName, { label: string; description: string; system: boolean }> = {
  admin: { label: "Admin", description: "Everything, including staff accounts.", system: true },
  editor: { label: "Editor", description: "The knowledge base and trip chat, but not staff accounts.", system: true },
  support: {
    label: "Support",
    description: "Works the support inbox; read-only knowledge and travellers. No staff users or audit log.",
    system: true,
  },
  traveler: { label: "Traveller", description: "Their own profile, saved places and trips. No staff screens.", system: true },
};

const MATRIX: { group: string; rows: { label: string; note: string; allowed: RoleName[] }[] }[] = [
  {
    group: "Knowledge base",
    rows: [
      { label: "View locations, tags, hierarchy", note: "GET /admin/locations", allowed: ["admin", "editor", "support"] },
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
      { label: "Work the review queue", note: "GET /admin/review-queue", allowed: ["admin", "editor", "support"] },
      { label: "See destinations and system health", note: "GET /admin/destinations, /admin/system", allowed: ["admin", "editor", "support"] },
      { label: "Inspect any traveller's profile", note: "GET /admin/travelers", allowed: ["admin", "editor", "support"] },
      { label: "Preview recommendations for a traveller", note: "GET /admin/recommendations/preview", allowed: ["admin", "editor", "support"] },
      { label: "Use the staff trip chat", note: "POST /chat/sessions", allowed: ["admin", "editor", "traveler"] },
    ],
  },
  {
    group: "Support inbox",
    rows: [
      { label: "Work the inbox (list, reply, resolve)", note: "GET/PATCH /admin/support/*", allowed: ["admin", "editor", "support"] },
      { label: "Change routing settings", note: "PUT /admin/support/routing", allowed: ["admin", "editor"] },
    ],
  },
  {
    group: "Administration",
    rows: [
      { label: "List staff users", note: "GET /admin/users", allowed: ["admin"] },
      { label: "Create staff and change roles", note: "POST, PATCH /admin/users", allowed: ["admin"] },
      { label: "Read the audit log", note: "GET /admin/audit-log", allowed: ["admin"] },
    ],
  },
  {
    group: "Traveller side",
    rows: [
      { label: "Own profile and saved places", note: "GET, PUT /profiles/me", allowed: ["admin", "editor", "support", "traveler"] },
      { label: "Own trips and chat", note: "/chat/*", allowed: ["admin", "editor", "traveler"] },
      { label: "Raise a support ticket", note: "POST /support/tickets", allowed: ["admin", "editor", "support", "traveler"] },
      { label: "Browse published places", note: "/explore/*", allowed: ["admin", "editor", "support", "traveler"] },
    ],
  },
];

export default function RolesPage() {
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <Td className="bg-surface-2 text-xs font-medium uppercase tracking-wide text-muted">
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
        These four roles are fixed in code. Custom roles and per-capability editors need a permissions table — designed,
        not built.
      </p>
    </div>
  );
}
