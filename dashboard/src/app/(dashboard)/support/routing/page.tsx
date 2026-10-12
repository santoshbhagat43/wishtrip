"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus, Plus, Timer, Wand2 } from "lucide-react";
import { useState } from "react";

import { SupportTabs } from "@/components/support-tabs";
import { Card, ErrorNote, HeaderStats, PageHeader, Spinner } from "@/components/ui/card";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";

type Method = Schemas["RoutingMethod"];
type Availability = Schemas["Availability"];
type Agent = Schemas["RoutingAgent"];

const METHODS: { value: Method; label: string; hint: string }[] = [
  {
    value: "round_robin",
    label: "Round robin",
    hint: "Each new ticket goes to the next agent in the rotation who is online and under their limit.",
  },
  {
    value: "least_busy",
    label: "Least busy",
    hint: "Each new ticket goes to whoever is holding the fewest open tickets.",
  },
  {
    value: "manual",
    label: "Manual",
    hint: "Nothing is assigned automatically. Every ticket waits in Unassigned for someone to pick up.",
  },
];

const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "away", label: "Away" },
  { value: "off_shift", label: "Off shift" },
];

const REASSIGN_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

function initials(name: string) {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "··";
}

export default function SupportRoutingPage() {
  const queryClient = useQueryClient();
  const [destination, setDestination] = useState("");
  const [channel, setChannel] = useState("in_app");
  const [handlesDraft, setHandlesDraft] = useState<Record<string, string>>({});

  const routing = useQuery({
    queryKey: ["support-routing"],
    queryFn: async () => unwrap(await api.GET("/admin/support/routing")),
  });
  const preview = useQuery({
    queryKey: ["support-routing", "preview", destination, channel],
    enabled: false,
    queryFn: async () =>
      unwrap(
        await api.GET("/admin/support/routing/preview", {
          params: { query: { destination: destination || undefined, channel } },
        }),
      ),
  });

  const done = () => queryClient.invalidateQueries({ queryKey: ["support-routing"] });
  const saveConfig = useMutation({
    mutationFn: async (body: Schemas["RoutingUpdate"]) => unwrap(await api.PUT("/admin/support/routing", { body })),
    onSuccess: done,
  });
  const saveAgent = useMutation({
    mutationFn: async ({ userId, body }: { userId: string; body: Schemas["AgentRoutingUpdate"] }) =>
      unwrap(
        await api.PATCH("/admin/support/routing/agents/{user_id}", {
          params: { path: { user_id: userId } },
          body,
        }),
      ),
    onSuccess: done,
  });

  if (routing.isLoading) return <Spinner />;
  if (routing.error) return <ErrorNote error={routing.error} />;

  const data = routing.data!;
  const method = METHODS.find((m) => m.value === data.method)!;
  const inRotation = data.agents.filter((a) => a.in_rotation && a.availability === "online");

  function swap(agent: Agent, direction: -1 | 1) {
    const ordered = [...data.agents].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((a) => a.user_id === agent.user_id);
    const other = ordered[index + direction];
    if (!other) return;
    saveAgent.mutate({ userId: agent.user_id, body: { position: other.position } });
    saveAgent.mutate({ userId: other.user_id, body: { position: agent.position } });
  }

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <PageHeader
        breadcrumb="Support"
        title="Routing"
        description="How a new ticket finds an agent. Changes take effect on the next ticket — nothing already assigned moves."
        action={
          <HeaderStats
            items={[
              { value: inRotation.length, label: "agents taking tickets" },
              { value: data.next_agent ?? "nobody", label: "up next" },
            ]}
          />
        }
      />

      <SupportTabs />

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_540px] flex-col gap-5">
          <Card className="p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">How tickets are assigned</p>
            <div className="mt-3 flex flex-wrap gap-1 self-start rounded-full bg-surface-2 p-1">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  aria-pressed={m.value === data.method}
                  onClick={() => saveConfig.mutate({ method: m.value })}
                  className={`h-[38px] rounded-full px-4 text-[13px] font-bold transition-colors ${
                    m.value === data.method ? "bg-brand text-on-brand" : "text-muted hover:text-text"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">{method.hint}</p>

            <div className="mt-5 rounded-2xl bg-surface-2 px-4 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Next new ticket goes to</p>
              <p className="mt-1 font-display text-xl leading-tight">{data.next_agent ?? "Nobody"}</p>
              <p className="mt-0.5 text-[13px] text-muted">{data.next_reason}</p>
            </div>
            <ErrorNote error={saveConfig.error} />
          </Card>

          <Card className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Agents</p>
                <p className="mt-1 text-sm text-muted">
                  Every active staff account. Order decides the round-robin; a limit stops someone being handed more
                  than they can hold.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col overflow-hidden rounded-[18px] border border-border">
              <div className="grid grid-cols-[32px_minmax(170px,1.3fr)_118px_104px_minmax(0,1fr)_84px] gap-3 bg-surface-2 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                <span>#</span>
                <span>Agent</span>
                <span>Availability</span>
                <span>Open / limit</span>
                <span>Handles</span>
                <span className="text-right">Rotation</span>
              </div>
              {data.agents.map((agent) => {
                const name = agent.full_name || agent.email;
                const atLimit = agent.open_tickets >= agent.capacity;
                return (
                  <div
                    key={agent.user_id}
                    className="grid grid-cols-[32px_minmax(170px,1.3fr)_118px_104px_minmax(0,1fr)_84px] items-center gap-3 border-t border-border px-4 py-3"
                  >
                    <span className="flex flex-col items-center gap-0.5">
                      <button
                        aria-label={`Move ${name} up`}
                        onClick={() => swap(agent, -1)}
                        className="rounded p-0.5 hover:bg-surface-2"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        aria-label={`Move ${name} down`}
                        onClick={() => swap(agent, 1)}
                        className="rounded p-0.5 hover:bg-surface-2"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-9 flex-none items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand">
                        {initials(name)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold">{name}</span>
                          {agent.is_next && (
                            <span className="rounded-full bg-brand-soft px-2 py-px text-[10.5px] font-extrabold text-brand">
                              Next
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted">{titleCase(agent.role)}</span>
                      </span>
                    </span>
                    <select
                      aria-label={`${name} availability`}
                      value={agent.availability}
                      onChange={(e) =>
                        saveAgent.mutate({
                          userId: agent.user_id,
                          body: { availability: e.target.value as Availability },
                        })
                      }
                      className="h-9 rounded-full border border-border bg-surface px-2.5 text-[13px]"
                    >
                      {AVAILABILITY.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    <span className="flex items-center gap-1.5">
                      <button
                        aria-label={`Lower ${name}'s limit`}
                        disabled={agent.capacity <= 0}
                        onClick={() => saveAgent.mutate({ userId: agent.user_id, body: { capacity: agent.capacity - 1 } })}
                        className="rounded-full border border-border p-1 hover:bg-surface-2 disabled:opacity-40"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className={`tabular-nums text-sm ${atLimit ? "font-bold text-warn" : ""}`}>
                        {agent.open_tickets}/{agent.capacity}
                      </span>
                      <button
                        aria-label={`Raise ${name}'s limit`}
                        onClick={() => saveAgent.mutate({ userId: agent.user_id, body: { capacity: agent.capacity + 1 } })}
                        className="rounded-full border border-border p-1 hover:bg-surface-2"
                      >
                        <Plus className="size-3" />
                      </button>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1">
                      {agent.handles.map((handle) => (
                        <button
                          key={handle}
                          aria-label={`Remove ${handle} from ${name}`}
                          onClick={() =>
                            saveAgent.mutate({
                              userId: agent.user_id,
                              body: { handles: agent.handles.filter((h) => h !== handle) },
                            })
                          }
                          className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11.5px] hover:bg-danger-soft hover:text-danger"
                        >
                          {handle} ×
                        </button>
                      ))}
                      <input
                        aria-label={`Add what ${name} handles`}
                        value={handlesDraft[agent.user_id] ?? ""}
                        onChange={(e) => setHandlesDraft({ ...handlesDraft, [agent.user_id]: e.target.value })}
                        onKeyDown={(e) => {
                          const value = (handlesDraft[agent.user_id] ?? "").trim();
                          if (e.key !== "Enter" || !value) return;
                          saveAgent.mutate({
                            userId: agent.user_id,
                            body: { handles: [...agent.handles, value] },
                          });
                          setHandlesDraft({ ...handlesDraft, [agent.user_id]: "" });
                        }}
                        placeholder="add…"
                        className="h-7 w-16 rounded-full border border-dashed border-border bg-transparent px-2 text-[11.5px]"
                      />
                    </span>
                    <span className="text-right">
                      <input
                        aria-label={`${name} in rotation`}
                        type="checkbox"
                        checked={agent.in_rotation}
                        onChange={(e) =>
                          saveAgent.mutate({ userId: agent.user_id, body: { in_rotation: e.target.checked } })
                        }
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[13px] text-muted">
              A destination, channel or topic in <strong>Handles</strong> wins before the method is applied — so a
              WhatsApp message about Kerala goes to whoever handles it, if they are free.
            </p>
            <ErrorNote error={saveAgent.error} />
          </Card>
        </div>

        <aside className="flex min-w-0 flex-[1_1_310px] flex-col gap-4">
          <Card className="p-5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              <Timer className="size-3.5" /> If nobody replies
            </p>
            <p className="mt-1.5 text-sm text-muted">
              Move the ticket to the next agent in the rotation when the first reply hasn&apos;t gone out in time.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {REASSIGN_OPTIONS.map((option) => {
                const active = (data.reassign_after_minutes ?? 0) === option.value;
                return (
                  <button
                    key={option.value}
                    aria-pressed={active}
                    onClick={() => saveConfig.mutate({ reassign_after_minutes: option.value })}
                    className={`h-9 rounded-full border px-3.5 text-[13px] font-bold transition-colors ${
                      active ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:text-text"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[12.5px] text-muted">
              Checked whenever an agent opens the inbox, so it needs no background scheduler. Internal notes don&apos;t
              count as a reply.
            </p>
          </Card>

          <Card className="p-5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              <Wand2 className="size-3.5" /> Try it
            </p>
            <p className="mt-1.5 text-sm text-muted">Who would take a ticket like this? Nothing is assigned.</p>
            <div className="mt-3 flex flex-col gap-2">
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Destination, e.g. Goa"
                className="h-10 rounded-full border border-border bg-surface px-4 text-sm"
              />
              <select
                aria-label="Channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="h-10 rounded-full border border-border bg-surface px-3 text-sm"
              >
                {["in_app", "email", "whatsapp", "phone"].map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => preview.refetch()}
                className="h-10 rounded-full bg-brand text-sm font-bold text-on-brand hover:bg-brand-strong"
              >
                Assign a test ticket
              </button>
            </div>
            {preview.data && (
              <div className="mt-3 rounded-2xl bg-brand-soft px-3.5 py-3 text-[13px]">
                <p className="font-bold text-brand">{preview.data.agent_name ?? "Nobody"}</p>
                <p className="mt-0.5 text-muted">{preview.data.reason}</p>
              </div>
            )}
            <ErrorNote error={preview.error} />
          </Card>

          <Card className="p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Recent assignments</p>
            {data.recent.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">
                Nothing routed yet. The next ticket a traveller opens will appear here with the reason.
              </p>
            ) : (
              <ol className="mt-2 flex list-none flex-col gap-2.5 p-0">
                {data.recent.map((log, i) => (
                  <li key={i} className="border-b border-border pb-2.5 last:border-0 last:pb-0">
                    <p className="text-[13px]">
                      <span className="tabular-nums text-muted">#{log.ticket_number}</span>{" "}
                      <span className="text-muted">→</span>{" "}
                      <span className="font-bold">{log.agent_name ?? "Unassigned"}</span>
                    </p>
                    <p className="text-[12.5px] text-muted">{log.reason}</p>
                    <p className="text-[11.5px] text-muted/80">{relativeTime(log.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
