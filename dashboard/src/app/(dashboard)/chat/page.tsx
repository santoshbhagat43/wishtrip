"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { MessageSquarePlus, SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AssistantMessage } from "@/components/chat/assistant-message";
import { Button } from "@/components/ui/button";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { api, unwrap, type ChatMessage } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";

const STARTERS = [
  "Plan 5 relaxed days in Kerala for my parents",
  "Street food and nightlife in Bangkok with friends",
  "3 days in Kyoto for a couple who love temples",
  "What can we do in Goa with kids?",
];

export default function ChatPage() {
  const queryClient = useQueryClient();
  // undefined = follow the most recent conversation; null = a new, unsaved conversation.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sessions = useQuery({ queryKey: ["chat-sessions"], queryFn: async () => unwrap(await api.GET("/chat/sessions")) });
  const activeId = selectedId === undefined ? (sessions.data?.[0]?.id ?? null) : selectedId;
  const setActiveId = setSelectedId;
  const detail = useQuery({
    queryKey: ["chat", activeId],
    enabled: !!activeId,
    queryFn: async () => unwrap(await api.GET("/chat/sessions/{chat_id}", { params: { path: { chat_id: activeId! } } })),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail.data, pending]);

  const send = useMutation({
    mutationFn: async (content: string) => {
      let chatId = activeId;
      if (!chatId) {
        chatId = unwrap(await api.POST("/chat/sessions")).id;
        setActiveId(chatId);
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
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/chat/sessions/{chat_id}", { params: { path: { chat_id: id } } })),
    onSuccess: () => {
      setActiveId(null);
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    },
  });

  function submit(text = draft) {
    const content = text.trim();
    if (content && !send.isPending) send.mutate(content);
  }

  const messages: ChatMessage[] = (detail.data?.messages ?? []) as ChatMessage[];
  const state = detail.data?.state ?? {};

  return (
    <div className="mx-auto grid max-w-7xl gap-4 xl:h-[calc(100dvh-4rem)] xl:grid-cols-[220px_minmax(0,1fr)_240px]">
      <aside className="flex flex-col gap-2 xl:overflow-y-auto">
        <Button variant="secondary" onClick={() => setActiveId(null)}>
          <MessageSquarePlus className="size-4" /> New trip
        </Button>
        <ul className="flex gap-1 overflow-x-auto xl:flex-col">
          {sessions.data?.map((s) => (
            <li key={s.id} className="shrink-0">
              <button
                onClick={() => setActiveId(s.id)}
                className={clsx(
                  "group flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm",
                  activeId === s.id ? "bg-brand-soft text-brand" : "hover:bg-surface-2",
                )}
              >
                <span className="min-w-0">
                  <span className="block max-w-48 truncate font-medium">{s.title}</span>
                  <span className="text-xs text-muted">{relativeTime(s.updated_at)}</span>
                </span>
                <Trash2
                  className="mt-0.5 size-3.5 shrink-0 text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this conversation?")) remove.mutate(s.id);
                  }}
                />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="@container flex min-h-[70dvh] flex-col rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {!activeId && !pending && (
            <div className="mx-auto max-w-lg py-10 text-center">
              <h1 className="text-[27px] leading-tight">Plan a trip, your way</h1>
              <p className="mt-1 text-sm text-muted">
                Grok reads the knowledge base before answering. Prices are only shown when verified.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => submit(s)} className="rounded-2xl border border-border px-4 py-3 text-left text-sm transition-colors hover:border-brand hover:bg-brand-soft">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeId && detail.isLoading && <Spinner />}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-on-brand">{m.content}</p>
              </div>
            ) : (
              <AssistantMessage key={m.id} message={m} onFollowUp={submit} />
            ),
          )}
          {pending && (
            <>
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-on-brand">{pending}</p>
              </div>
              <p className="flex items-center gap-2 text-sm text-muted">
                <span className="size-3 animate-pulse rounded-full bg-brand" /> Understanding your request and checking the knowledge base…
              </p>
            </>
          )}
          <ErrorNote error={send.error} />
          <div ref={bottomRef} />
        </div>
        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            rows={1}
            className="min-h-10 resize-none"
            placeholder="Where do you want to go, with whom, and what do you love?"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button type="submit" variant="accent" disabled={!draft.trim() || send.isPending} aria-label="Send">
            <SendHorizontal className="size-4" />
          </Button>
        </form>
      </section>

      <aside className="rounded-2xl border border-border bg-surface p-4 shadow-card xl:self-start">
        <h2 className="text-sm font-semibold">Trip so far</h2>
        <p className="mt-0.5 text-xs text-muted">What the assistant has understood across this conversation.</p>
        {Object.keys(state).length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing yet.</p>
        ) : (
          <dl className="mt-4 space-y-2.5 text-sm">
            {Object.entries(state).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{titleCase(k)}</dt>
                <dd className="capitalize">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </aside>
    </div>
  );
}
