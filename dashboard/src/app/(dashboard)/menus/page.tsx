"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Card, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { titleCase } from "@/lib/format";

type Group = Schemas["MenuGroupRead"];
type Item = Schemas["MenuItemRead"];
type Placement = Schemas["MenuPlacement"];

const PLACEMENTS: { value: Placement; label: string; note: string }[] = [
  { value: "header", label: "Header", note: "The bar at the top of every traveller page." },
  { value: "footer", label: "Footer", note: "Grouped link lists at the foot of the site." },
  { value: "mobile", label: "Mobile", note: "The slide-out menu on small screens." },
];

export default function MenusPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newMenu, setNewMenu] = useState("");
  const [newPlacement, setNewPlacement] = useState<Placement>("header");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [placeId, setPlaceId] = useState("");

  const menus = useQuery({
    queryKey: ["menus"],
    queryFn: async () => unwrap(await api.GET("/admin/menus")),
  });
  const cities = useQuery({
    queryKey: ["locations", "cities-for-menus"],
    queryFn: async () =>
      unwrap(
        await api.GET("/admin/locations", {
          params: { query: { type: ["city"], status: "published", page_size: 100 } },
        }),
      ),
  });

  const done = () => queryClient.invalidateQueries({ queryKey: ["menus"] });

  const createMenu = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/admin/menus", { body: { name: newMenu, placement: newPlacement, is_active: true } })),
    onSuccess: (group) => {
      setNewMenu("");
      setSelectedId(group.id);
      done();
    },
  });
  const removeMenu = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/admin/menus/{group_id}", { params: { path: { group_id: id } } })),
    onSuccess: () => {
      setSelectedId(null);
      done();
    },
  });
  const toggleMenu = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) =>
      unwrap(await api.PATCH("/admin/menus/{group_id}", { params: { path: { group_id: id } }, body: { is_active } })),
    onSuccess: done,
  });
  const addLink = useMutation({
    mutationFn: async (groupId: string) =>
      unwrap(
        await api.POST("/admin/menus/{group_id}/items", {
          params: { path: { group_id: groupId } },
          body: {
            label,
            url: placeId ? "" : url,
            location_id: placeId || null,
            is_active: true,
            opens_in_new_tab: false,
          },
        }),
      ),
    onSuccess: () => {
      setLabel("");
      setUrl("");
      setPlaceId("");
      done();
    },
  });
  const changeLink = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Schemas["MenuItemUpdate"] }) =>
      unwrap(await api.PATCH("/admin/menu-items/{item_id}", { params: { path: { item_id: id } }, body })),
    onSuccess: done,
  });
  const removeLink = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/admin/menu-items/{item_id}", { params: { path: { item_id: id } } })),
    onSuccess: done,
  });

  if (menus.isLoading) return <Spinner />;
  if (menus.error) return <ErrorNote error={menus.error} />;

  const groups = menus.data!;
  const current = groups.find((g) => g.id === selectedId) ?? groups[0];
  const liveLinks = groups.filter((g) => g.is_active).flatMap((g) => g.items.filter((i) => i.is_active)).length;

  function move(group: Group, item: Item, direction: -1 | 1) {
    const ordered = [...group.items].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((i) => i.id === item.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    changeLink.mutate({ id: item.id, body: { position: swap.position } });
    changeLink.mutate({ id: swap.id, body: { position: item.position } });
  }

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <PageHeader
        breadcrumb="Content"
        title="Menus"
        description="The traveller site's navigation. Links here go live immediately — a link to a place that is unpublished is hidden rather than broken."
        action={
          <HeaderStats
            items={[
              { value: groups.length, label: "menus" },
              { value: liveLinks, label: "live links" },
            ]}
          />
        }
      />

      <div className="flex flex-wrap items-start gap-5">
        <section className="flex min-w-0 flex-[1_1_300px] flex-col gap-2.5">
          {PLACEMENTS.map((placement) => {
            const inPlacement = groups.filter((g) => g.placement === placement.value);
            return (
              <div key={placement.value} className="flex flex-col gap-2">
                <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{placement.label}</p>
                {inPlacement.length === 0 && <p className="px-1 text-[13px] text-muted">{placement.note}</p>}
                {inPlacement.map((group) => {
                  const picked = current?.id === group.id;
                  return (
                    <button
                      key={group.id}
                      aria-pressed={picked}
                      onClick={() => setSelectedId(group.id)}
                      className={`flex w-full cursor-pointer flex-col gap-1 rounded-[18px] border px-4 py-3.5 text-left shadow-card transition-colors ${
                        picked ? "border-brand bg-brand-soft/50" : "border-border bg-surface hover:border-brand/40"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-[15px] font-bold">{group.name}</span>
                        {!group.is_active && (
                          <span className="rounded-full bg-surface-2 px-2 py-px text-[10.5px] font-extrabold text-muted">
                            Hidden
                          </span>
                        )}
                        <span className="ml-auto text-xs tabular-nums text-muted">{group.items.length} links</span>
                      </span>
                      <span className="truncate text-[12.5px] text-muted">
                        {group.items.map((i) => i.label).join(" · ") || "No links yet"}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}

          <Card className="mt-2 flex flex-col gap-2 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">New menu</p>
            <input
              value={newMenu}
              onChange={(e) => setNewMenu(e.target.value)}
              placeholder="e.g. Things to do"
              className="h-10 rounded-full border border-border bg-surface px-4 text-sm"
            />
            <div className="flex gap-2">
              <select
                aria-label="Placement"
                value={newPlacement}
                onChange={(e) => setNewPlacement(e.target.value as Placement)}
                className="h-10 flex-1 rounded-full border border-border bg-surface px-3 text-sm"
              >
                {PLACEMENTS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                disabled={!newMenu.trim() || createMenu.isPending}
                onClick={() => createMenu.mutate()}
                className="flex h-10 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-50"
              >
                <Plus className="size-4" /> Add
              </button>
            </div>
            <ErrorNote error={createMenu.error} />
          </Card>
        </section>

        {current && (
          <Card className="flex min-w-0 flex-[999_1_520px] flex-col gap-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                  {titleCase(current.placement)} · /{current.slug}
                </span>
                <h2 className="font-display text-[26px] leading-[1.15]">{current.name}</h2>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={current.is_active}
                    onChange={(e) => toggleMenu.mutate({ id: current.id, is_active: e.target.checked })}
                  />
                  Visible on the site
                </label>
                <button
                  onClick={() => confirm(`Delete “${current.name}” and its links?`) && removeMenu.mutate(current.id)}
                  className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-bold text-danger hover:bg-danger-soft"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </div>
            </div>

            <div className="flex flex-col overflow-hidden rounded-[18px] border border-border">
              <div className="grid grid-cols-[1fr_1fr_150px] gap-3 bg-surface-2 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                <span>Label</span>
                <span>Goes to</span>
                <span className="text-right">Order</span>
              </div>
              {current.items.length === 0 && (
                <p className="border-t border-border px-4 py-6 text-center text-sm text-muted">
                  No links yet. Add the first one below.
                </p>
              )}
              {current.items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_1fr_150px] items-center gap-3 border-t border-border px-4 py-3"
                >
                  <span className="flex items-center gap-2">
                    <GripVertical className="size-4 shrink-0 text-muted/50" />
                    <span className={`text-sm font-bold ${item.is_active ? "" : "text-muted line-through"}`}>
                      {item.label}
                    </span>
                  </span>
                  <span className="truncate text-[13px] text-muted">
                    {item.location_name ? (
                      <span className="flex items-center gap-1.5">
                        <span className="rounded-full bg-brand-soft px-2 py-px text-[11px] font-bold text-brand">Place</span>
                        {item.location_name}
                      </span>
                    ) : (
                      <span className="font-mono">{item.resolved_url}</span>
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-1">
                    <button
                      aria-label={`Move ${item.label} up`}
                      onClick={() => move(current, item, -1)}
                      className="rounded-full p-1.5 hover:bg-surface-2"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      aria-label={`Move ${item.label} down`}
                      onClick={() => move(current, item, 1)}
                      className="rounded-full p-1.5 hover:bg-surface-2"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    <input
                      aria-label={`${item.label} visible`}
                      type="checkbox"
                      checked={item.is_active}
                      onChange={(e) => changeLink.mutate({ id: item.id, body: { is_active: e.target.checked } })}
                    />
                    <button
                      aria-label={`Remove ${item.label}`}
                      onClick={() => removeLink.mutate(item.id)}
                      className="rounded-full p-1.5 text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Add a link</p>
              <div className="flex flex-wrap gap-2">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label travellers see"
                  className="h-10 min-w-[180px] flex-1 rounded-full border border-border bg-surface px-4 text-sm"
                />
                <select
                  aria-label="Link to a place"
                  value={placeId}
                  onChange={(e) => {
                    setPlaceId(e.target.value);
                    const city = cities.data?.items.find((c) => c.id === e.target.value);
                    if (city && !label) setLabel(city.name);
                  }}
                  className="h-10 min-w-[180px] flex-1 rounded-full border border-border bg-surface px-3 text-sm"
                >
                  <option value="">A path on the site…</option>
                  {(cities.data?.items ?? []).map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </select>
                {!placeId && (
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="/explore"
                    className="h-10 min-w-[160px] flex-1 rounded-full border border-border bg-surface px-4 font-mono text-sm"
                  />
                )}
                <button
                  disabled={!label.trim() || (!url.trim() && !placeId) || addLink.isPending}
                  onClick={() => addLink.mutate(current.id)}
                  className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-navy disabled:opacity-50"
                >
                  <Plus className="size-4" /> Add link
                </button>
              </div>
              <p className="text-[13px] text-muted">
                Linking to a place keeps the URL right if it is renamed, and hides the link automatically if it is ever
                unpublished.
              </p>
              <ErrorNote error={addLink.error ?? changeLink.error ?? removeLink.error} />
            </div>

            <a
              href="http://localhost:3002"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 self-start text-[13px] font-bold"
            >
              <ExternalLink className="size-4" /> See it on the traveller site
            </a>
          </Card>
        )}
      </div>
    </div>
  );
}
