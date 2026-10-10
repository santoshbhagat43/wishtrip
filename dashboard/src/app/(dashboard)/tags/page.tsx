"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { api, unwrap, type Schemas } from "@/lib/api/client";

const CATEGORIES = ["interest", "cuisine", "style", "amenity"] as const;

export default function TagsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("interest");
  const tags = useQuery({ queryKey: ["tags"], queryFn: async () => unwrap(await api.GET("/admin/tags")) });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST("/admin/tags", { body: { name, category } })),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/admin/tags/{tag_id}", { params: { path: { tag_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });

  const grouped: Record<string, Schemas["TagRead"][]> = {};
  for (const tag of tags.data ?? []) (grouped[tag.category] ??= []).push(tag);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Tags" description="Interests, cuisines and styles. Travelers' interests match places through these tags." />
      <Card className="mb-6">
        <form
          className="flex flex-wrap gap-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input className="max-w-xs" placeholder="New tag name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Select className="w-auto capitalize" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Button type="submit" disabled={create.isPending}>Add tag</Button>
        </form>
        <div className="px-4 pb-4"><ErrorNote error={create.error ?? remove.error} /></div>
      </Card>
      {tags.isLoading && <Spinner />}
      <div className="space-y-4">
        {Object.entries(grouped).map(([cat, list]) => (
          <Card key={cat}>
            <CardHeader title={<span className="capitalize">{cat}</span>} description={`${list.length} tags`} />
            <div className="flex flex-wrap gap-1.5 p-4">
              {list.map((tag) => (
                <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1.5 text-sm">
                  <Link href={`/locations?tag_id=${tag.id}`} className="hover:text-brand">{tag.name}</Link>
                  <button
                    aria-label={`Delete ${tag.name}`}
                    onClick={() => confirm(`Delete the tag “${tag.name}”? It will be removed from every location.`) && remove.mutate(tag.id)}
                  >
                    <X className="size-3.5 text-muted hover:text-danger" />
                  </button>
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
