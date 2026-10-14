"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { ChipToggle, Field, Input, Select, Textarea, TriState } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { api, unwrap, type Location, type LocationType, type Schemas } from "@/lib/api/client";
import { COST_LABELS, LOCATION_TYPES, SEASONS, STATUSES, TIMES, titleCase } from "@/lib/format";

import { KeyValueEditor, ListEditor } from "./list-editor";
import { LocationPicker } from "./location-picker";

export type LocationFormValue = Omit<Schemas["LocationCreate"], "opening_hours"> & {
  opening_hours: Record<string, string>;
};

export function emptyLocation(type: LocationType = "attraction"): LocationFormValue {
  return {
    type, name: "", parent_id: null, status: "draft", tag_ids: [], summary: "", description: "",
    latitude: null, longitude: null, address: "", region: "", aliases: [], highlight: false,
    duration_minutes: null, best_times: [], seasons: [], opening_hours: {}, cost_level: null,
    price_note: "", energy_level: null, difficulty: null, family_friendly: null,
    couple_friendly: null, accessible: null, pros: [], cons: [], tips: "", history: "",
  };
}

export function fromLocation(loc: Location): LocationFormValue {
  return {
    type: loc.type, name: loc.name, parent_id: loc.parent_id, status: loc.status,
    tag_ids: loc.tags.map((t) => t.id), summary: loc.summary, description: loc.description ?? "",
    latitude: loc.latitude ?? null, longitude: loc.longitude ?? null, address: loc.address ?? "",
    region: loc.region ?? "", aliases: loc.aliases ?? [], highlight: loc.highlight ?? false,
    duration_minutes: loc.duration_minutes ?? null, best_times: loc.best_times ?? [],
    seasons: loc.seasons ?? [], opening_hours: (loc.opening_hours ?? {}) as Record<string, string>,
    cost_level: loc.cost_level ?? null, price_note: loc.price_note ?? "",
    energy_level: loc.energy_level ?? null, difficulty: loc.difficulty ?? null,
    family_friendly: loc.family_friendly ?? null, couple_friendly: loc.couple_friendly ?? null,
    accessible: loc.accessible ?? null, pros: loc.pros ?? [], cons: loc.cons ?? [], tips: loc.tips ?? "",
    history: loc.history ?? "",
  };
}

type Section = "details" | "travel" | "characteristics" | "knowledge";

const num = (v: string) => (v === "" ? null : Number(v));

export type LocationFormErrors = { name?: string; parent_id?: string };

/** Runs even when Details tab inputs are unmounted (HTML required cannot). */
export function validateLocationForm(value: LocationFormValue): LocationFormErrors {
  const errors: LocationFormErrors = {};
  if (!value.name.trim()) errors.name = "Enter a name.";
  if (value.type !== "country" && !value.parent_id) {
    errors.parent_id =
      value.type === "city" ? "Choose a country this city belongs to." : "Choose a city this place belongs to.";
  }
  return errors;
}

export function LocationForm({
  value,
  onChange,
  isNew,
  focusDetailsKey = 0,
  fieldErrors,
  onClearFieldError,
}: {
  value: LocationFormValue;
  onChange: (value: LocationFormValue) => void;
  isNew: boolean;
  /** Increment after failed create validation to show the Details tab. */
  focusDetailsKey?: number;
  fieldErrors?: LocationFormErrors;
  onClearFieldError?: (field: keyof LocationFormErrors) => void;
}) {
  const [section, setSection] = useState<Section>("details");
  useEffect(() => {
    if (focusDetailsKey > 0) setSection("details");
  }, [focusDetailsKey]);
  const set = <K extends keyof LocationFormValue>(key: K, v: LocationFormValue[K]) => onChange({ ...value, [key]: v });
  const isContainer = value.type === "country" || value.type === "city";
  const parentType: LocationType | null = value.type === "country" ? null : value.type === "city" ? "country" : "city";

  const parent = useQuery({
    queryKey: ["location", value.parent_id],
    enabled: !!value.parent_id,
    queryFn: async () =>
      unwrap(await api.GET("/admin/locations/{location_id}", { params: { path: { location_id: value.parent_id! } } })),
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: async () => unwrap(await api.GET("/admin/tags")) });
  const [tagFilter, setTagFilter] = useState("");
  const tagGroups = useMemo(() => {
    const groups: Record<string, Schemas["TagRead"][]> = {};
    for (const tag of tags.data ?? []) {
      if (tagFilter && !tag.name.toLowerCase().includes(tagFilter.toLowerCase()) && !value.tag_ids?.includes(tag.id)) continue;
      (groups[tag.category] ??= []).push(tag);
    }
    return groups;
  }, [tags.data, tagFilter, value.tag_ids]);

  return (
    <Card>
      <div className="px-5 pt-2">
        <Tabs
          value={section}
          onChange={setSection}
          tabs={[
            { id: "details", label: "Details" },
            { id: "travel", label: "Travel info" },
            ...(isContainer ? [] : [{ id: "characteristics" as const, label: "Characteristics" }]),
            { id: "knowledge", label: "Knowledge & tags" },
          ]}
        />
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        {section === "details" && (
          <>
            <Field label="Name" className="sm:col-span-2" error={fieldErrors?.name}>
              <Input
                value={value.name}
                onChange={(e) => {
                  onClearFieldError?.("name");
                  set("name", e.target.value);
                }}
                required
                aria-invalid={!!fieldErrors?.name}
                className={fieldErrors?.name ? "border-danger" : undefined}
              />
            </Field>
            <Field label="Type">
              <Select value={value.type} disabled={!isNew} onChange={(e) => onChange({ ...value, type: e.target.value as LocationType, parent_id: null })}>
                {LOCATION_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </Select>
            </Field>
            <Field label="Status" hint="Only published locations reach travelers and the AI.">
              <Select value={value.status} onChange={(e) => set("status", e.target.value as LocationFormValue["status"])}>
                {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
            </Field>
            {parentType && (
              <Field label={`Belongs to (${parentType})`} error={fieldErrors?.parent_id}>
                {value.parent_id ? (
                  <div className="flex h-10 items-center justify-between rounded-xl border-[1.5px] border-border px-3 text-sm">
                    <span className={parent.data ? "" : "text-muted"}>
                      {parent.data
                        ? `${parent.data.name}${parent.data.parent ? ` — ${parent.data.parent.name}` : ""}`
                        : "Loading…"}
                    </span>
                    <button type="button" className="text-xs text-muted hover:text-text" onClick={() => set("parent_id", null)}>
                      Change
                    </button>
                  </div>
                ) : (
                  <LocationPicker
                    types={[parentType]}
                    placeholder={`Search ${parentType}…`}
                    invalid={!!fieldErrors?.parent_id}
                    onPick={(loc) => {
                      onClearFieldError?.("parent_id");
                      set("parent_id", loc.id);
                    }}
                  />
                )}
              </Field>
            )}
            {value.type === "city" && (
              <Field label="Region / state" hint='Lets travelers ask for "Kerala" and get every Kerala city.'>
                <Input value={value.region ?? ""} onChange={(e) => set("region", e.target.value)} />
              </Field>
            )}
            {isContainer && (
              <Field label="Also known as" hint='Other names travelers use, e.g. "Dharamshala" for McLeod Ganj.' className="sm:col-span-2">
                <ListEditor value={value.aliases ?? []} onChange={(v) => set("aliases", v)} placeholder="Add a name" />
              </Field>
            )}
            <Field label="Summary" hint="One line, shown in lists and given to the AI." className="sm:col-span-2">
              <Input value={value.summary ?? ""} maxLength={500} onChange={(e) => set("summary", e.target.value)} />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea rows={5} value={value.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="Latitude">
              <Input type="number" step="any" value={value.latitude ?? ""} onChange={(e) => set("latitude", num(e.target.value))} />
            </Field>
            <Field label="Longitude">
              <Input type="number" step="any" value={value.longitude ?? ""} onChange={(e) => set("longitude", num(e.target.value))} />
            </Field>
            <Field label="Address / area" className="sm:col-span-2">
              <Input value={value.address ?? ""} onChange={(e) => set("address", e.target.value)} />
            </Field>
            {!isContainer && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={value.highlight ?? false} onChange={(e) => set("highlight", e.target.checked)} />
                Must-see highlight <span className="text-muted">— breaks ties in ranking; never overrides a traveler&apos;s constraints</span>
              </label>
            )}
          </>
        )}

        {section === "travel" && (
          <>
            <Field label="Duration (minutes)" hint="Required for itinerary planning. The AI may not change it.">
              <Input type="number" min={0} value={value.duration_minutes ?? ""} onChange={(e) => set("duration_minutes", num(e.target.value))} />
            </Field>
            <Field label="Cost level">
              <Select value={value.cost_level ?? ""} onChange={(e) => set("cost_level", num(e.target.value))}>
                <option value="">Unknown</option>
                {COST_LABELS.map((label, i) => <option key={label} value={i}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Verified price" hint="Shown to travelers exactly as written. Leave empty unless verified — travelers then see “price not available yet”." className="sm:col-span-2">
              <Input value={value.price_note ?? ""} placeholder="e.g. ₹500 per adult (checked Oct 2026)" onChange={(e) => set("price_note", e.target.value)} />
            </Field>
            <Field label="Best time of day" className="sm:col-span-2">
              <ChipToggle options={TIMES} value={value.best_times ?? []} onChange={(v) => set("best_times", v as LocationFormValue["best_times"])} />
            </Field>
            <Field label="Seasons" className="sm:col-span-2">
              <ChipToggle options={SEASONS} value={value.seasons ?? []} onChange={(v) => set("seasons", v as LocationFormValue["seasons"])} />
            </Field>
            <Field label="Opening hours" hint="Add a source and verified date as rows too." className="sm:col-span-2">
              <KeyValueEditor value={value.opening_hours} onChange={(v) => set("opening_hours", v)} />
            </Field>
          </>
        )}

        {section === "characteristics" && (
          <>
            <Field label="Energy level" hint="1 very relaxed — 5 very active">
              <Select value={value.energy_level ?? ""} onChange={(e) => set("energy_level", num(e.target.value))}>
                <option value="">Unknown</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label="Difficulty" hint="1 easy — 5 strenuous">
              <Select value={value.difficulty ?? ""} onChange={(e) => set("difficulty", num(e.target.value))}>
                <option value="">Unknown</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label="Family friendly"><TriState value={value.family_friendly} onChange={(v) => set("family_friendly", v)} /></Field>
            <Field label="Good for couples"><TriState value={value.couple_friendly} onChange={(v) => set("couple_friendly", v)} /></Field>
            <Field label="Wheelchair accessible" hint="“No” excludes it for travelers with accessibility needs.">
              <TriState value={value.accessible} onChange={(v) => set("accessible", v)} />
            </Field>
          </>
        )}

        {section === "knowledge" && (
          <>
            <Field label="Pros"><ListEditor value={value.pros ?? []} onChange={(v) => set("pros", v)} placeholder="Great river views" /></Field>
            <Field label="Cons"><ListEditor value={value.cons ?? []} onChange={(v) => set("cons", v)} placeholder="Busy at midday" /></Field>
            <Field label="Insider tips" className="sm:col-span-2">
              <Textarea value={value.tips ?? ""} onChange={(e) => set("tips", e.target.value)} />
            </Field>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Tags <span className="text-muted">({value.tag_ids?.length ?? 0})</span></span>
                <Input className="max-w-56" placeholder="Filter tags" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} />
              </div>
              {Object.entries(tagGroups).map(([category, list]) => (
                <div key={category}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{category}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((tag) => {
                      const on = value.tag_ids?.includes(tag.id);
                      return (
                        <button
                          type="button"
                          key={tag.id}
                          onClick={() =>
                            set("tag_ids", on ? value.tag_ids!.filter((id) => id !== tag.id) : [...(value.tag_ids ?? []), tag.id])
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:text-text"}`}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
