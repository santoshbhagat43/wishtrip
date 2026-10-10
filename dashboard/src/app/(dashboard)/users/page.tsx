"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";
import { useMe } from "@/lib/hooks/use-me";

type Role = "admin" | "editor" | "traveler";

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [form, setForm] = useState({ email: "", full_name: "", password: "", role: "editor" as Role });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => unwrap(await api.GET("/admin/users", { params: { query: { page_size: 100 } } })),
  });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST("/admin/users", { body: form })),
    onSuccess: () => {
      setForm({ email: "", full_name: "", password: "", role: "editor" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { role?: Role; is_active?: boolean } }) =>
      unwrap(await api.PATCH("/admin/users/{user_id}", { params: { path: { user_id: id } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  if (me && me.role !== "admin") return <ErrorNote error="Only admins can manage users." />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Staff users" description="Admins manage everything; editors manage the knowledge base." />
      <Card className="mb-6">
        <form
          className="grid gap-2 p-4 sm:grid-cols-[1fr_1fr_1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Input type="password" placeholder="Temporary password (8+)" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Select className="w-auto" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </Select>
          <Button type="submit" disabled={create.isPending}>Invite</Button>
        </form>
        <div className="px-4 pb-4"><ErrorNote error={create.error ?? update.error} /></div>
      </Card>
      <Card>
        {users.isLoading ? (
          <Spinner />
        ) : (
          <Table>
            <thead><tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Joined</Th><Th /></tr></thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id}>
                  <Td><p className="font-medium">{u.full_name || "—"}</p><p className="text-xs text-muted">{u.email}</p></Td>
                  <Td>
                    {u.role === "traveler" ? (
                      <Badge>traveler</Badge>
                    ) : (
                      <Select
                        className="w-auto"
                        value={u.role}
                        disabled={u.id === me?.id}
                        onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as Role } })}
                      >
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </Select>
                    )}
                  </Td>
                  <Td><Badge tone={u.is_active ? "ok" : "neutral"}>{u.is_active ? "Active" : "Disabled"}</Badge></Td>
                  <Td className="text-muted">{relativeTime(u.created_at)}</Td>
                  <Td className="text-right">
                    {u.id !== me?.id && (
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, body: { is_active: !u.is_active } })}>
                        {u.is_active ? "Disable" : "Enable"}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
