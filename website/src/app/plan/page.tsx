"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bookmark, Image as ImageIcon, Link2, MessageSquare, MessageSquarePlus, SendHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { AssistantReply } from "@/components/chat/assistant-reply";
import { Button } from "@/components/ui/button";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { api, unwrap, type ChatMessage } from "@/lib/api/client";
import { COST_LABELS, tripStateRows } from "@/lib/format";

type InputMode = "chat" | "link" | "screenshot" | "saved";

const STARTERS = [
  "5 relaxed days in Kerala with my parents",
  "A week in Goa for our honeymoon — beaches and sunsets",
  "Street food and night markets in Bangkok with friends",
  "3 days in Kyoto, temples early in the morning",
];

function Planner() {
  const queryClient = useQueryClient();
  const prompt = useSearchParams().get("prompt");
  const [selected, setSelected] = useState<string | null | undefined>(prompt ? null : undefined);
  const [draft, setDraft] = useState(prompt ?? "");
  const [mode, setMode] = useState<InputMode>("chat");
  const [pending, setPending] = useState<string | null>(null);
  const latest = useRef<HTMLDivElement>(null);

  const sessions = useQuery({ queryKey: ["chats"], queryFn: async () => unwrap(await api.GET("/chat/sessions")) });
  const activeId = selected === undefined ? (sessions.data?.[0]?.id ?? null) : selected;
  const chat = useQuery({
    queryKey: ["chat", activeId],
    enabled: !!activeId,
    queryFn: async () => unwrap(await api.GET("/chat/sessions/{chat_id}", { params: { path: { chat_id: activeId! } } })),
  });
  const profile = useQuery({ queryKey: ["profile"], queryFn: async () => unwrap(await api.GET("/profiles/me")) });
  const saved = useQuery({ queryKey: ["saved"], queryFn: async () => unwrap(await api.GET("/profiles/me/saved")) });

  // Bring the newest message's start into view (not the page bottom), so replies read top-down.
  useEffect(() => {
    latest.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.data, pending]);

  const send = useMutation({
    mutationFn: async (content: string) => {
      let chatId = activeId;
      if (!chatId) {
        chatId = unwrap(await api.POST("/chat/sessions")).id;
        setSelected(chatId);
      }
      return unwrap(await api.POST("/chat/sessions/{chat_id}/messages", { params: { path: { chat_id: chatId } }, body: { content } }));
    },
    onMutate: (content) => {
      setPending(content);
      setDraft("");
    },
    onSettled: () => setPending(null),
    onSuccess: (turn) => {
      queryClient.invalidateQueries({ queryKey: ["chat", turn.session.id] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/chat/sessions/{chat_id}", { params: { path: { chat_id: id } } })),
    onSuccess: () => {
      setSelected(undefined);
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });

  function submit(text = draft) {
    const content = text.trim();
    if (content && !send.isPending) send.mutate(content);
  }

  const messages = (chat.data?.messages ?? []) as ChatMessage[];
  const state = chat.data?.state ?? {};
  const p = profile.data;

  return (
    <div className="mx-auto grid max-w-7xl gap-5 px-4 py-6 xl:grid-cols-[220px_minmax(0,1fr)_260px]">
      <aside className="flex flex-col gap-2">
        <Button variant="secondary" onClick={() => setSelected(null)}><MessageSquarePlus className="size-4" /> New trip</Button>
        <ul className="flex gap-1 overflow-x-auto xl:flex-col">
          {sessions.data?.map((s) => (
            <li key={s.id} className="shrink-0">
              <div className={clsx("group flex items-start justify-between gap-2 rounded-xl px-3 py-2 text-sm", activeId === s.id ? "bg-brand-soft text-brand" : "hover:bg-surface-2")}>
                <button onClick={() => setSelected(s.id)} className="min-w-0 text-left">
                  <span className="block max-w-44 truncate font-medium">{s.title}</span>
                </button>
                <button aria-label={`Delete ${s.title}`} onClick={() => confirm("Delete this trip conversation?") && remove.mutate(s.id)}>
                  <Trash2 className="size-3.5 text-muted opacity-0 hover:text-danger group-hover:opacity-100" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className="@container flex min-h-[75dvh] flex-col rounded-[22px] border border-border bg-surface shadow-card">
        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {!activeId && !pending && (
            <div className="mx-auto max-w-xl py-8 text-center">
              <h1 className="text-[32px] leading-tight">Where to next?</h1>
              <p className="mt-2 text-muted">Tell us the trip you&apos;re dreaming of — where, how long, who&apos;s coming, what you love.</p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => submit(s)} className="rounded-2xl border border-border px-4 py-3 text-left text-sm transition-colors hover:border-brand hover:bg-brand-soft">{s}</button>
                ))}
              </div>
            </div>
          )}
          {activeId && chat.isLoading && <Spinner />}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={m.id} ref={!pending && i === messages.length - 2 ? latest : undefined} className="flex justify-end">
                <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-on-brand">{m.content}</p>
              </div>
            ) : (
              <AssistantReply key={m.id} message={m} onFollowUp={submit} />
            ),
          )}
          {pending && (
            <>
              <div ref={latest} className="flex justify-end"><p className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-on-brand">{pending}</p></div>
              <p className="flex items-center gap-2 text-sm text-muted">
                <span className="size-3 animate-pulse rounded-full bg-brand" /> Understanding your trip, finding places and checking the plan works…
              </p>
            </>
          )}
          <ErrorNote error={send.error} />
        </div>

        <div className="border-t border-border px-3 pt-1">
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { id: "chat", label: "Describe it" },
              { id: "link", label: "Paste a link" },
              { id: "screenshot", label: "Screenshot" },
              { id: "saved", label: "Saved places", count: saved.data?.length },
            ]}
          />
        </div>
        {mode === "chat" && (
          <form className="flex items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <MessageSquare className="mb-3 size-4 shrink-0 text-muted" />
            <Textarea
              rows={1}
              className="min-h-11 resize-none"
              placeholder="e.g. 4 days in Munnar with my wife, slow pace, love tea and views"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Button type="submit" variant="accent" disabled={!draft.trim() || send.isPending} aria-label="Send"><SendHorizontal className="size-4" /></Button>
          </form>
        )}
        {mode === "link" && (
          <div className="flex flex-col gap-2 p-3 text-sm">
            <div className="flex items-center gap-2"><Link2 className="size-4 text-muted" /><Input disabled placeholder="Instagram, TikTok, YouTube or Reddit link" /></div>
            <p className="text-muted">Coming soon — we can&apos;t read reels or posts yet. For now, describe what you saw in “Describe it”.</p>
          </div>
        )}
        {mode === "screenshot" && (
          <div className="flex items-center gap-2 p-3 text-sm text-muted">
            <ImageIcon className="size-4" /> Coming soon — planning from a screenshot or photo isn&apos;t available yet.
          </div>
        )}
        {mode === "saved" && (
          <div className="p-3 text-sm">
            {saved.data?.length ? (
              <>
                <p className="mb-2 text-muted">Tap places to add them to your message:</p>
                <div className="flex flex-wrap gap-1.5">
                  {saved.data.map((s) => (
                    <button key={s.place.id} onClick={() => { setDraft((d) => `${d ? `${d.trim()} ` : ""}Include ${s.place.name}${s.place.parent ? ` in ${s.place.parent.name}` : ""}.`); setMode("chat"); }}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium hover:border-brand hover:text-brand">
                      <Bookmark className="size-3" /> {s.place.name}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted">No saved places yet — <Link href="/explore" className="font-semibold text-brand">explore</Link> and tap Save.</p>
            )}
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-4 xl:self-start">
        <div className="rounded-[22px] border border-border bg-surface p-4 shadow-card">
          <h2 className="font-display text-lg">Your trip so far</h2>
          {Object.keys(state).length === 0 ? (
            <p className="mt-2 text-sm text-muted">We&apos;ll fill this in as we understand your trip.</p>
          ) : (
            <dl className="mt-3 space-y-2 text-sm">
              {tripStateRows(state as Record<string, unknown>).map(({ label, value }) => (
                <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="break-words">{value}</dd></div>
              ))}
            </dl>
          )}
        </div>
        <div className="rounded-[22px] border border-border bg-surface p-4 text-sm shadow-card">
          <div className="flex items-center justify-between"><h2 className="font-display text-lg">From your profile</h2><Link href="/profile" className="text-xs font-semibold text-brand">Edit</Link></div>
          <ul className="mt-2 space-y-1 text-muted">
            <li>Travelling: <span className="capitalize text-text">{p?.companions ?? "not set"}</span></li>
            <li>Budget: <span className="text-text">{p?.budget_level != null ? COST_LABELS[p.budget_level] : "not set"}</span></li>
            <li>Pace: <span className="text-text">{p?.energy_level ? `${p.energy_level}/5` : "not set"}</span></li>
            {p?.accessibility_needs && <li className="text-text">Wheelchair-accessible places only</li>}
            <li>Saved places: <span className="text-text">{saved.data?.length ?? 0}</span></li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

export default function PlanPage() {
  return <Suspense><Planner /></Suspense>;
}
