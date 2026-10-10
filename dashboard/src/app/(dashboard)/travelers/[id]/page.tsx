"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { api, unwrap } from "@/lib/api/client";
import { COST_LABELS, relativeTime, titleCase } from "@/lib/format";

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${value >= 0.75 ? "bg-ok" : value <= 0.3 ? "bg-danger" : "bg-brand"}`} style={{ width: `${value * 100}%` }} />
    </div>
  );
}

export default function TravelerPage() {
  const { id } = useParams<{ id: string }>();
  const [cityId, setCityId] = useState("");

  const traveler = useQuery({
    queryKey: ["traveler", id],
    queryFn: async () => unwrap(await api.GET("/admin/travelers/{user_id}", { params: { path: { user_id: id } } })),
  });
  const cities = useQuery({
    queryKey: ["cities"],
    queryFn: async () =>
      unwrap(await api.GET("/admin/locations", { params: { query: { type: ["city"], status: "published", page_size: 200 } } })),
  });
  const recs = useQuery({
    queryKey: ["recs-preview", id, cityId],
    enabled: !!cityId,
    queryFn: async () =>
      unwrap(
        await api.GET("/admin/recommendations/preview", { params: { query: { user_id: id, city_id: cityId, limit: 15 } } }),
      ),
  });

  if (traveler.isLoading) return <Spinner />;
  if (traveler.error) return <ErrorNote error={traveler.error} />;
  const t = traveler.data!;
  const p = t.profile;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t.full_name || t.email} description={t.email} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Profile" description="What they told us." />
            {!p ? (
              <Empty title="No profile yet" />
            ) : (
              <dl className="space-y-2.5 p-5 text-sm">
                <div><dt className="text-xs text-muted">Travels with</dt><dd className="capitalize">{p.companions ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">Budget</dt><dd>{p.budget_level != null ? COST_LABELS[p.budget_level] : "—"}</dd></div>
                <div><dt className="text-xs text-muted">Energy</dt><dd>{p.energy_level != null ? `${p.energy_level}/5` : "—"}</dd></div>
                <div><dt className="text-xs text-muted">Preferred times</dt><dd className="capitalize">{p.preferred_times?.join(", ") || "—"}</dd></div>
                <div><dt className="text-xs text-muted">Travel style</dt><dd className="capitalize">{p.travel_styles?.join(", ") || "—"}</dd></div>
                <div><dt className="text-xs text-muted">Food</dt><dd className="capitalize">{p.food_preferences?.join(", ") || "—"}</dd></div>
                <div><dt className="text-xs text-muted">Accessibility needs</dt><dd>{p.accessibility_needs ? "Yes" : "No"}</dd></div>
              </dl>
            )}
          </Card>
          <Card>
            <CardHeader title="Behavior" description="Recent signals that shift ranking." />
            {t.recent_events.length === 0 ? (
              <Empty title="No signals yet" />
            ) : (
              <ul className="divide-y divide-border">
                {t.recent_events.map(({ event, location: loc }) => (
                  <li key={event.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span>
                      <Badge tone={["skipped", "removed"].includes(event.event_type) ? "danger" : "ok"}>{event.event_type}</Badge>{" "}
                      <Link href={`/locations/${loc.id}`} className="hover:text-brand">{loc.name}</Link>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{relativeTime(event.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Recommendation inspector"
            description="Profile → preference engine → candidate search → ranking. Each bar is one ranking signal."
            action={
              <Field label="" className="w-56">
                <Select value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label="City">
                  <option value="">Choose a city…</option>
                  {[...(cities.data?.items ?? [])]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => <option key={c.id} value={c.id}>{c.name}{c.parent ? ` — ${c.parent.name}` : ""}</option>)}
                </Select>
              </Field>
            }
          />
          {!cityId ? (
            <Empty title="Pick a city to see ranked recommendations" />
          ) : recs.isLoading ? (
            <Spinner label="Ranking…" />
          ) : recs.error ? (
            <div className="p-4"><ErrorNote error={recs.error} /></div>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border px-5 py-3 text-xs text-muted">
                <span>Weights: {Object.entries(recs.data!.weights).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(" · ")}</span>
                {recs.data!.preferences.query_text && <span>Semantic query: “{recs.data!.preferences.query_text}”</span>}
              </div>
              {recs.data!.items.length === 0 ? (
                <Empty title="Nothing passes this traveler's hard constraints here" />
              ) : (
                <ol className="divide-y divide-border">
                  {recs.data!.items.map((item, i) => (
                    <li key={item.location.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_220px]">
                      <div>
                        <p className="text-sm">
                          <span className="mr-2 tabular-nums text-muted">{i + 1}.</span>
                          <Link href={`/locations/${item.location.id}`} className="font-medium hover:text-brand">{item.location.name}</Link>
                          <span className="ml-2 text-xs capitalize text-muted">{item.location.type}</span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {item.reasons.map((r) => <Badge key={r} tone="ok">{r}</Badge>)}
                          {item.warnings.map((w) => <Badge key={w} tone="danger">{w}</Badge>)}
                        </div>
                        <p className="mt-2 text-sm font-semibold tabular-nums">Score {item.score.toFixed(3)}</p>
                      </div>
                      <dl className="grid grid-cols-[72px_1fr] items-center gap-x-2 gap-y-1 text-xs">
                        {Object.entries(item.components).map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted">{titleCase(k)}</dt>
                            <dd><Bar value={v} /></dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
