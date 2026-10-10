"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty, ErrorNote } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, unwrap } from "@/lib/api/client";
import { RELATIONS, minutes, titleCase } from "@/lib/format";

import { LocationPicker, type PickedLocation } from "./location-picker";

export function RelationsPanel({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const key = ["relations", locationId];
  const [target, setTarget] = useState<PickedLocation | null>(null);
  const [relation, setRelation] = useState<(typeof RELATIONS)[number]>("near");
  const [travel, setTravel] = useState("");
  const [note, setNote] = useState("");

  const relations = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await api.GET("/admin/locations/{location_id}/relations", { params: { path: { location_id: locationId } } })),
  });
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/admin/locations/{location_id}/relations", {
          params: { path: { location_id: locationId } },
          body: { target_id: target!.id, relation, travel_minutes: travel ? Number(travel) : null, note },
        }),
      ),
    onSuccess: () => {
      setTarget(null);
      setTravel("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/admin/relations/{relation_id}", { params: { path: { relation_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card>
      <CardHeader
        title="Relationships"
        description="How this place connects to others. Travel minutes are what the planner trusts — not straight-line distance."
      />
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr_auto]">
        <Field label="Related location">
          {target ? (
            <div className="flex h-9 items-center justify-between rounded-lg border border-border px-3 text-sm">
              {target.name}
              <button className="text-xs text-muted hover:text-text" onClick={() => setTarget(null)}>Change</button>
            </div>
          ) : (
            <LocationPicker excludeId={locationId} onPick={setTarget} />
          )}
        </Field>
        <Field label="Relation">
          <Select value={relation} onChange={(e) => setRelation(e.target.value as typeof relation)}>
            {RELATIONS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
          </Select>
        </Field>
        <Field label="Travel minutes">
          <Input type="number" min={0} value={travel} onChange={(e) => setTravel(e.target.value)} />
        </Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="by road, via…" /></Field>
        <div className="flex items-end">
          <Button disabled={!target || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
        <div className="sm:col-span-full"><ErrorNote error={add.error ?? remove.error} /></div>
      </div>
      {relations.data?.length === 0 ? (
        <Empty title="No relationships yet" />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {relations.data?.map((rel) => {
            const outgoing = rel.source.id === locationId;
            const other = outgoing ? rel.target : rel.source;
            return (
              <li key={rel.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">{titleCase(rel.relation)}</span>
                  <ArrowRight className={`size-3.5 text-muted ${outgoing ? "" : "rotate-180"}`} />
                  <Link href={`/locations/${other.id}`} className="font-medium hover:text-brand">{other.name}</Link>
                  <span className="text-xs capitalize text-muted">{other.type}</span>
                  {rel.travel_minutes != null && <span className="text-muted">· {minutes(rel.travel_minutes)}</span>}
                  {rel.note && <span className="text-muted">· {rel.note}</span>}
                </div>
                <button aria-label="Delete relationship" onClick={() => remove.mutate(rel.id)}>
                  <Trash2 className="size-4 text-muted hover:text-danger" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
