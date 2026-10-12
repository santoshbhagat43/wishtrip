"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { MessageSquarePlus, RotateCcw, SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AssistantMessage } from "@/components/chat/assistant-message";
import { Button } from "@/components/ui/button";
import { ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { api, unwrap, type ChatMessage } from "@/lib/api/client";
import { relativeTime, titleCase } from "@/lib/format";

const STARTERS = [
  "Plan 5 relaxed days in Kerala for my parents",
  "Street food and nightlife in Bangkok with friends",
  "3 days in Kyoto for a couple who love temples",
  "What can we do in Goa with kids?",
];

// What the pipeline is doing while the traveler waits; a plan with the plan check takes ~30–90 s.
const STAGES = [
  { after: 0, label: "Understanding your request" },
  { after: 4, label: "Searching the knowledge base" },
  { after: 9, label: "Writing the reply" },
  { after: 30, label: "Checking the plan works — opening days, travel time, pace" },
];

const ENERGY = ["", "very relaxed", "relaxed", "moderate", "active", "very active"];
const BUDGET = ["free", "budget", "mid-range", "premium", "luxury"];
const STATE_ORDER = ["destination", "duration_days", "start_date", "companions", "interests", "energy_level", "budget_level", "preferred_times"];

function stateValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (key === "energy_level" && typeof value === "number") return `${titleCase(ENERGY[value] ?? "")} (${value}/5)`;
  if (key === "budget_level" && typeof value === "number") return titleCase(BUDGET[value] ?? String(value));
  if (key === "duration_days" && typeof value === "number") return `${value} day${value === 1 ? "" : "s"}`;
  if (key === "start_date" && typeof value === "string") {
    return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return titleCase(String(value));
}

function stateLabel(key: string) {
  return { duration_days: "Trip length", start_date: "Starts", energy_level: "Pace", budget_level: "Budget" }[key] ?? titleCase(key);
}

function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [running]);
  return seconds;
}

export default function ChatPage() {
  const queryClient = useQueryClient();
  // undefined = follow the most recent conversation; null = a new, unsaved conversation.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shownChat = useRef<string | null>(null);

  const sessions = useQuery({ queryKey: ["chat-sessions"], queryFn: async () => unwrap(await api.GET("/chat/sessions")) });
  const activeId = selectedId === undefined ? (sessions.data?.[0]?.id ?? null) : selectedId;
  const detail = useQuery({
    queryKey: ["chat", activeId],
    enabled: !!activeId,
    queryFn: async () => unwrap(await api.GET("/chat/sessions/{chat_id}", { params: { path: { chat_id: activeId! } } })),
  });

  const send = useMutation({
    mutationFn: async (content: string) => {
      let chatId = activeId;
      if (!chatId) {
        chatId = unwrap(await api.POST("/chat/sessions")).id;
        setSelectedId(chatId);
        queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
      }
      return unwrap(await api.POST("/chat/sessions/{chat_id}/messages", { params: { path: { chat_id: chatId } }, body: { content } }));
    },
    onMutate: (content) => {
      setPending(content);
      setFailed(null);
      setDraft("");
    },
    onError: (_error, content) => {
      // Keep what they typed: a failed send shouldn't make anyone retype a long request.
      setFailed(content);
      setDraft((current) => current || content);
    },
    onSettled: () => setPending(null),
    onSuccess: async (turn) => {
      await queryClient.invalidateQueries({ queryKey: ["chat", turn.session.id] });
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/chat/sessions/{chat_id}", { params: { path: { chat_id: id } } })),
    onSuccess: (_data, id) => {
      if (id === activeId) setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    },
  });
  const elapsed = useElapsed(send.isPending);
  const stage = [...STAGES].reverse().find((s) => elapsed >= s.after) ?? STAGES[0];

  const messages: ChatMessage[] = (detail.data?.messages ?? []) as ChatMessage[];
  const state = (detail.data?.state ?? {}) as Record<string, unknown>;
  const stateEntries = Object.entries(state)
    .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
    .sort(([a], [b]) => (STATE_ORDER.indexOf(a) + 1 || 99) - (STATE_ORDER.indexOf(b) + 1 || 99));
  const lastId = messages.at(-1)?.id;

  // Opening a conversation jumps to its latest turn; a new reply scrolls to where that turn
  // starts (the traveler's message), so a long itinerary is read from the top, not the end.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (pending) {
      box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
      return;
    }
    const turns = box.querySelectorAll<HTMLElement>("[data-user-turn]");
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) return;
    // Only "opened" once its messages are on screen; they load after the conversation is picked.
    const opened = shownChat.current !== activeId;
    shownChat.current = activeId;
    box.scrollTo({ top: Math.max(0, lastTurn.offsetTop - 16), behavior: opened ? "auto" : "smooth" });
  }, [activeId, lastId, pending]);

  // The composer grows with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function submit(text = draft) {
    const content = text.trim();
    if (content && !send.isPending) send.mutate(content);
  }

  function startNew() {
    setSelectedId(null);
    setFailed(null);
    send.reset();
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageHeader
        breadcrumb="Intelligence"
        title="Trip chat"
        description="The traveller's pipeline, with its working shown: the intent it read, the records it used, and the exact context the model was given."
      />

      <div className="grid grid-cols-1 gap-4 xl:h-[calc(100dvh-13rem)] xl:grid-cols-[232px_minmax(0,1fr)_248px]">
        <aside className="flex min-w-0 flex-col gap-2 xl:overflow-y-auto">
          <button
            onClick={startNew}
            className={clsx(
              "flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border text-sm font-bold transition-colors hover:border-brand hover:bg-brand-soft",
              activeId === null ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface",
            )}
          >
            <MessageSquarePlus className="size-4" /> New trip
          </button>
          <ul className="flex min-w-0 gap-1 overflow-x-auto pb-1 xl:flex-col xl:pb-0">
            {sessions.data?.map((s) => (
              <li key={s.id} className="group relative w-56 shrink-0 xl:w-auto">
                <button
                  onClick={() => setSelectedId(s.id)}
                  aria-current={activeId === s.id ? "true" : undefined}
                  title={s.title}
                  className={clsx(
                    "w-full rounded-[14px] py-2.5 pl-3 pr-8 text-left text-sm transition-colors",
                    activeId === s.id ? "bg-brand-soft text-brand" : "hover:bg-surface-2",
                  )}
                >
                  <span className={clsx("line-clamp-2", activeId === s.id ? "font-semibold" : "font-medium")}>{s.title}</span>
                  <span className="text-xs text-muted">{relativeTime(s.updated_at)}</span>
                </button>
                <button
                  aria-label={`Delete conversation: ${s.title}`}
                  onClick={() => {
                    if (confirm("Delete this conversation?")) remove.mutate(s.id);
                  }}
                  className="absolute right-1.5 top-2 rounded-md p-1 text-muted opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="@container flex h-[calc(100dvh-7rem)] min-h-[26rem] min-w-0 flex-col rounded-[22px] border border-border bg-surface shadow-card xl:h-auto xl:min-h-0">
          <div ref={scrollRef} className="relative flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
            {!activeId && !pending && (
              <div className="mx-auto max-w-lg py-10 text-center">
                <p className="font-display text-[26px] leading-tight">Plan a trip, your way</p>
                <p className="mt-1 text-sm text-muted">
                  The assistant reads the knowledge base before answering. Prices are only shown when verified.
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
            <ErrorNote error={detail.error} />
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} data-user-turn className="flex justify-end">
                  <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-on-brand">{m.content}</p>
                </div>
              ) : (
                <AssistantMessage key={m.id} message={m} onFollowUp={submit} />
              ),
            )}
            {pending && (
              <>
                <div className="flex justify-end">
                  <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-on-brand">{pending}</p>
                </div>
                <p role="status" className="flex items-center gap-2 text-sm text-muted">
                  <span className="size-3 animate-pulse rounded-full bg-brand" />
                  {stage.label}…
                  <span className="tabular-nums text-xs">{elapsed}s</span>
                </p>
              </>
            )}
            {failed && !pending && (
              <div className="flex flex-wrap items-center gap-2">
                <ErrorNote error={send.error} />
                <Button variant="secondary" size="sm" onClick={() => submit(failed)}>
                  <RotateCcw className="size-3.5" /> Try again
                </Button>
              </div>
            )}
          </div>
          <form
            className="border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                rows={1}
                aria-label="Message"
                className="min-h-10 resize-none"
                placeholder="Where do you want to go, with whom, and what do you love?"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <Button type="submit" variant="accent" disabled={!draft.trim() || send.isPending} aria-label="Send">
                <SendHorizontal className="size-4" />
              </Button>
            </div>
            <p className="mt-1.5 hidden px-1 text-[11px] text-muted sm:block">Enter to send · Shift + Enter for a new line</p>
          </form>
        </section>

        <aside className="min-w-0 rounded-[22px] border border-border bg-surface p-4 shadow-card xl:self-start">
          <h2 className="text-sm font-semibold">Trip so far</h2>
          <p className="mt-0.5 text-xs text-muted">What the assistant has understood across this conversation.</p>
          {stateEntries.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Nothing yet.</p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm xl:grid-cols-1">
              {stateEntries.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted">{stateLabel(k)}</dt>
                  <dd className="break-words">{stateValue(k, v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}
