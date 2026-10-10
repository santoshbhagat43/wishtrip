"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty, ErrorNote } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, errorMessage, unwrap } from "@/lib/api/client";

export function MediaPanel({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("image");
  const [caption, setCaption] = useState("");
  const [author, setAuthor] = useState("");
  const [link, setLink] = useState("");
  const key = ["media", locationId];

  const media = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await api.GET("/admin/locations/{location_id}/media", { params: { path: { location_id: locationId } } })),
  });
  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("caption", caption);
      form.set("author", author);
      const file = fileRef.current?.files?.[0];
      if (file) form.set("file", file);
      if (link) form.set("external_url", link);
      const res = await fetch(`/api/backend/admin/locations/${locationId}/media`, { method: "POST", body: form });
      if (!res.ok) throw new Error(errorMessage(await res.json().catch(() => ({}))));
    },
    onSuccess: () => {
      setCaption("");
      setAuthor("");
      setLink("");
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/admin/media/{media_id}", { params: { path: { media_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card>
      <CardHeader title="Media" description="Photos, videos and influencer content for this place." />
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="influencer">Influencer content</option>
            </Select>
          </Field>
          <Field label="File" hint="Images or videos, up to 25 MB">
            <input ref={fileRef} type="file" accept="image/*,video/*" className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm" />
          </Field>
          <Field label="…or a link" hint="YouTube, Instagram reel, etc.">
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Caption"><Input value={caption} onChange={(e) => setCaption(e.target.value)} /></Field>
          <Field label="Author / creator"><Input value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
        </div>
        <div className="flex items-end">
          <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
            <Upload className="size-4" /> {upload.isPending ? "Uploading…" : "Add"}
          </Button>
        </div>
        <div className="sm:col-span-2"><ErrorNote error={upload.error ?? remove.error} /></div>
      </div>
      {media.data?.length === 0 ? (
        <Empty title="No media yet" />
      ) : (
        <ul className="grid gap-3 border-t border-border p-5 sm:grid-cols-2 lg:grid-cols-3">
          {media.data?.map((item) => (
            <li key={item.id} className="overflow-hidden rounded-lg border border-border">
              {item.kind === "image" && item.storage_key ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.caption || "Location photo"} className="aspect-video w-full object-cover" />
              ) : (
                <a href={item.url} target="_blank" rel="noreferrer" className="flex aspect-video items-center justify-center gap-1.5 bg-surface-2 text-sm text-brand">
                  <ExternalLink className="size-4" /> Open {item.kind}
                </a>
              )}
              <div className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <Badge>{item.kind}</Badge>
                  {item.caption && <p className="mt-1 truncate text-sm">{item.caption}</p>}
                  {item.author && <p className="text-xs text-muted">by {item.author}</p>}
                </div>
                <button aria-label="Delete media" onClick={() => remove.mutate(item.id)}>
                  <Trash2 className="size-4 text-muted hover:text-danger" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
