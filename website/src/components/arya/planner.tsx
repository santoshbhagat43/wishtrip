"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Bookmark, History, LifeBuoy, MessageSquarePlus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { FlowHeader } from "@/components/b4/flow";
import { AssistantReply } from "@/components/chat/assistant-reply";
import { UserBubble, withQuestion } from "@/components/chat/follow-ups";
import { hasCheckedPlan, hasGeneralPlan, TripBoard } from "@/components/chat/trip-board";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { api, unwrap, type ChatMessage } from "@/lib/api/client";
import { useMe } from "@/lib/session";

import { AryaAvatar } from "./avatar";

type Tray = "saved" | "help" | null;

const STARTERS = [
  "5 relaxed days in Kerala with my parents",
  "A week in Goa for our honeymoon: beaches and sunsets",
  "Street food and night markets in Bangkok with friends",
  "3 days in Kyoto, temples early in the morning",
];

/** The board sits beside the chat from this width; below it, plans show inline in the chat. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Arya (/arya): the real planner in the B4 design: Arya's chat on the left, the trip board that
 *  fills in as you talk on the right. Every answer is grounded in the places WishTrip has checked. */
export function AryaPlanner() {
  const queryClient = useQueryClient();
  const search = useSearchParams();
  const router = useRouter();
  const prompt = search.get("prompt");
  const me = useMe();
  // ?session= opens a chat that was started elsewhere (a pasted reel); ?prompt= fills the box.
  const [selected, setSelected] = useState<string | null | undefined>(search.get("session") ?? (prompt ? null : undefined));
  const [draft, setDraft] = useState(prompt ?? "");
  // The question the traveller is typing an answer to ("Type my own…"), sent along with it.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [tray, setTray] = useState<Tray>(null);
  const [trips, setTrips] = useState(false);
  const [helpSubject, setHelpSubject] = useState("");
  const [helpBody, setHelpBody] = useState("");
  const [helpNotice, setHelpNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tripsMenu = useRef<HTMLDivElement>(null);
  const shownChat = useRef<string | null>(null);
  const wide = useWide();
  // The reply whose plan is on the board: picked by the traveller, else the latest plan.
  const [picked, setPicked] = useState<{ chat: string | null; message: string } | null>(null);

  useEffect(() => {
    if (me.isFetched && !me.data) {
      void fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.replace(window.location.href));
    }
  }, [me.isFetched, me.data]);

  const sessions = useQuery({ queryKey: ["chats"], enabled: !!me.data, queryFn: async () => unwrap(await api.GET("/chat/sessions")) });
  const activeId = selected === undefined ? (sessions.data?.[0]?.id ?? null) : selected;
  const chat = useQuery({
    queryKey: ["chat", activeId],
    enabled: !!me.data && !!activeId,
    queryFn: async () => unwrap(await api.GET("/chat/sessions/{chat_id}", { params: { path: { chat_id: activeId! } } })),
  });
  const profile = useQuery({ queryKey: ["profile"], enabled: !!me.data, queryFn: async () => unwrap(await api.GET("/profiles/me")) });
  const saved = useQuery({ queryKey: ["saved"], enabled: !!me.data, queryFn: async () => unwrap(await api.GET("/profiles/me/saved")) });

  // Show the start of the latest turn (the traveller's message, then the reply below it), so a
  // long plan reads top-down. Opening a conversation jumps there; a new reply glides there.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (pending) {
      box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
      return;
    }
    const turns = box.querySelectorAll<HTMLElement>("[data-user-turn]");
    const last = turns[turns.length - 1];
    if (!last) return;
    const opened = shownChat.current !== activeId;
    shownChat.current = activeId;
    box.scrollTo({ top: Math.max(0, last.offsetTop - 16), behavior: opened ? "auto" : "smooth" });
  }, [activeId, chat.data, pending]);

  useEffect(() => {
    if (!trips) return;
    const away = (e: MouseEvent) => !tripsMenu.current?.contains(e.target as Node) && setTrips(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setTrips(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [trips]);

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
      // A chat opened from a trip board changes that board: the next look at it is fresh.
      const board = turn.session.state?.my_trip;
      if (typeof board === "string") queryClient.invalidateQueries({ queryKey: ["mine-trip", board] });
    },
  });
  // ?send= is the first message of a chat opened from a trip board: sent once, then dropped from
  // the address so a reload doesn't send it again.
  const firstMessage = search.get("send");
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!firstMessage || sentFirst.current || !chat.data || chat.data.id !== search.get("session")) return;
    sentFirst.current = true;
    if (chat.data.messages.length === 0) send.mutate(firstMessage);
    router.replace(`/arya?session=${chat.data.id}`);
  }, [firstMessage, chat.data, search, router, send]);
  const askHelp = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/support/tickets", {
          body: {
            subject: helpSubject.trim(),
            body: helpBody.trim(),
            session_id: activeId,
            channel: "in_app",
            in_destination: false,
          },
        }),
      ),
    onSuccess: (ticket) => {
      setHelpBody("");
      setHelpNotice(`Request #${ticket.number} sent. We'll get back to you.`);
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
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
    if (!content || send.isPending) return;
    send.mutate(replyTo ? withQuestion(replyTo, content) : content);
    setReplyTo(null);
  }

  /** A tapped answer goes with its question: "Under 5" means nothing on its own. */
  function sendAnswer(question: string, answer: string) {
    if (send.isPending) return;
    setReplyTo(null);
    send.mutate(withQuestion(question, answer));
  }

  function answerOwn(question: string) {
    setReplyTo(question);
    setTray(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const messages = (chat.data?.messages ?? []) as ChatMessage[];
  const plans = messages.filter((m) => m.role === "assistant" && (hasCheckedPlan(m) || hasGeneralPlan(m)));
  const boardPlan = (picked?.chat === activeId ? plans.find((m) => m.id === picked?.message) : undefined) ?? plans.at(-1) ?? null;
  const state = chat.data?.state ?? {};
  const empty = !activeId && !pending;
  const name = me.data?.full_name || me.data?.email?.split("@")[0] || undefined;

  // Arya starts only once the traveller is signed in. The proxy sends a visitor with no session
  // to sign-in; a stale session (cookie kept, sign-in expired) is cleared here, which sends them
  // there too.
  if (!me.data) return <div className="min-h-dvh bg-white" aria-busy />;

  return (
    <div className="min-h-dvh bg-white text-[#0D2436]">
      <FlowHeader
        step={boardPlan ? 2 : 1}
        title="Arya"
        subtitle="Your wishtrip AI travel agent"
        signedIn={!!me.data}
        traveller={name}
      />

      <main className="mx-auto grid max-w-[1320px] grid-cols-1 gap-5 px-4 py-5 md:px-10 lg:h-[calc(100dvh-72px)] lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:overflow-hidden">
        <section aria-label="Chat with Arya" className="@container flex min-h-[80dvh] min-w-0 flex-col overflow-hidden rounded-[22px] border border-[#E3E8EE] bg-white lg:min-h-0">
          <header className="relative flex items-center gap-3 border-b border-[#E3E8EE] px-5 py-3.5">
            <AryaAvatar size={40} />
            <div className="min-w-0 flex-1 leading-tight">
              <h1 className="font-sans! m-0 text-[18px] font-bold">Arya</h1>
              <p className="m-0 truncate text-[12.5px] text-[#566E85]">Your wishtrip AI travel agent · never pays without your OK</p>
            </div>
            {typeof chat.data?.state?.my_trip === "string" && (
              <Link
                href={`/trip/mine/${chat.data.state.my_trip}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#E3E8EE] px-3 py-2 text-[13px] font-semibold text-[#0A7C80] no-underline hover:bg-[#F3F6F9]"
              >
                Open full board
              </Link>
            )}
            <div ref={tripsMenu} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={trips}
                onClick={() => setTrips((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#E3E8EE] px-3 py-2 text-[13px] font-semibold hover:bg-[#F3F6F9]"
              >
                <History className="size-4" /> <span className="hidden sm:inline">Your trips</span>
              </button>
              {trips && (
                <div role="menu" aria-label="Your trips" className="absolute right-0 top-[calc(100%+8px)] z-30 flex max-h-[360px] w-[280px] flex-col gap-1 overflow-y-auto rounded-2xl border border-[#E3E8EE] bg-white p-1.5 shadow-[0_14px_40px_rgba(7,35,56,.16)]">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSelected(null);
                      setReplyTo(null);
                      setTrips(false);
                    }}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-[#F3F6F9]"
                  >
                    <MessageSquarePlus className="size-4" /> New trip
                  </button>
                  {sessions.data?.map((s) => (
                    <div key={s.id} className={clsx("group flex items-start justify-between gap-2 rounded-xl px-3 py-2 text-sm", activeId === s.id ? "bg-[#DCF8F9]" : "hover:bg-[#F3F6F9]")}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSelected(s.id);
                          setReplyTo(null);
                          setTrips(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="line-clamp-2 font-medium" title={s.title}>
                          {s.title}
                        </span>
                      </button>
                      <button type="button" aria-label={`Delete ${s.title}`} onClick={() => confirm("Delete this trip conversation?") && remove.mutate(s.id)}>
                        <Trash2 className="size-3.5 text-[#566E85] hover:text-danger" />
                      </button>
                    </div>
                  ))}
                  {sessions.data?.length === 0 && <p className="m-0 px-3 py-2 text-xs text-[#566E85]">Your conversations will be listed here.</p>}
                </div>
              )}
            </div>
          </header>

          <div ref={scroller} className="relative flex-1 space-y-4 overflow-y-auto bg-[#F3F6F9] p-4 sm:p-5">
            {empty && (
              <div className="flex gap-3">
                <AryaAvatar size={28} />
                <p className="m-0 max-w-[85%] rounded-[16px] rounded-tl-sm border border-[#E3E8EE] bg-white px-4 py-3 text-[15px] leading-relaxed">
                  Hi{name ? ` ${name.split(" ")[0]}` : ""}! Tell me the trip you&rsquo;re dreaming of: where, how long, who&rsquo;s coming and what you love.
                  I&rsquo;ll plan it from places WishTrip has checked, and nothing is booked until you say so.
                </p>
              </div>
            )}
            {activeId && chat.isLoading && <Spinner />}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} data-user-turn>
                  <UserBubble content={m.content} />
                </div>
              ) : (
                <AssistantReply
                  key={m.id}
                  message={m}
                  onAnswer={sendAnswer}
                  onOwnAnswer={answerOwn}
                  latest={!pending && m.id === messages.at(-1)?.id}
                  startDate={typeof state.start_date === "string" ? state.start_date : null}
                  wide={wide}
                  onBoard={boardPlan?.id === m.id}
                  onShowOnBoard={() => setPicked({ chat: activeId, message: m.id })}
                />
              ),
            )}
            {pending && (
              <>
                <UserBubble content={pending} />
                <div className="flex items-center gap-3">
                  <AryaAvatar size={28} />
                  <p className="m-0 flex items-center gap-2 rounded-[16px] border border-[#E3E8EE] bg-white px-4 py-2.5 text-sm text-[#566E85]">
                    <span className="size-2.5 animate-pulse rounded-full bg-[#22DDE0]" /> Understanding your trip, finding places and checking the plan works…
                  </p>
                </div>
              </>
            )}
            <ErrorNote error={send.error} />
          </div>

          <div className="border-t border-[#E3E8EE] bg-white">
            {tray === "saved" && (
              <div className="border-b border-[#E3E8EE] p-4 text-sm">
                {saved.data?.length ? (
                  <>
                    <p className="mb-2 mt-0 text-[#566E85]">Tap places to add them to your message:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {saved.data.map((s) => (
                        <button
                          key={s.place.id}
                          type="button"
                          onClick={() => {
                            setDraft((d) => `${d ? `${d.trim()} ` : ""}Include ${s.place.name}${s.place.parent ? ` in ${s.place.parent.name}` : ""}.`);
                            setTray(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-[#E3E8EE] px-3 py-1 text-xs font-medium hover:border-[#0A7C80] hover:text-[#0A7C80]"
                        >
                          <Bookmark className="size-3" /> {s.place.name}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="m-0 text-[#566E85]">
                    No saved places yet. <Link href="/explore" className="font-semibold text-[#0A7C80]">Explore</Link> and tap Save.
                  </p>
                )}
              </div>
            )}
            {tray === "help" && (
              <div className="border-b border-[#E3E8EE] p-4 text-sm">
                {!activeId ? (
                  <p className="m-0 text-[#566E85]">Open or start a trip first so we can attach this request to it.</p>
                ) : (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setHelpNotice(null);
                      if (helpSubject.trim().length >= 3 && helpBody.trim()) askHelp.mutate();
                    }}
                  >
                    <p className="m-0 text-[#566E85]">A support agent will see this trip when they pick up your request.</p>
                    <Field label="Subject">
                      <Input value={helpSubject} onChange={(e) => setHelpSubject(e.target.value)} required minLength={3} placeholder="e.g. Temples are too early on day 1" />
                    </Field>
                    <Field label="Message">
                      <Textarea rows={3} className="min-h-16" value={helpBody} onChange={(e) => setHelpBody(e.target.value)} required placeholder="What should we look at on this plan?" />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={askHelp.isPending || helpSubject.trim().length < 3 || !helpBody.trim()}
                        className="rounded-full bg-[#22DDE0] px-5 py-2 text-sm font-bold text-[#072338] disabled:opacity-50"
                      >
                        {askHelp.isPending ? "Sending…" : "Send to support"}
                      </button>
                      {helpNotice && (
                        <span className="text-sm text-ok">
                          {helpNotice} <Link href="/help" className="font-semibold text-[#0A7C80]">Open Help</Link>
                        </span>
                      )}
                    </div>
                    <ErrorNote error={askHelp.error} />
                  </form>
                )}
              </div>
            )}

            {replyTo && (
              <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-[#DCF8F9] px-3 py-2 text-xs text-[#0A6B6E]">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">Answering: </span>
                  {replyTo}
                </span>
                <button type="button" aria-label="Stop answering this question" onClick={() => setReplyTo(null)} className="shrink-0 hover:text-[#0D2436]">
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            {empty && (
              <ul aria-label="Ideas to start with" className="m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 pt-3">
                {STARTERS.map((s) => (
                  <li key={s} className="flex-none">
                    <button
                      type="button"
                      onClick={() => submit(s)}
                      className="whitespace-nowrap rounded-full border border-[#22DDE0] bg-white px-4 py-2 text-[13.5px] font-semibold text-[#0A6B6E] hover:bg-[#DCF8F9]"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex items-end gap-2 p-4 pb-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex min-w-0 flex-1 items-end rounded-[26px] border border-[#E3E8EE] bg-white py-1.5 pl-5 pr-1.5 focus-within:border-[#0A7C80] focus-within:ring-2 focus-within:ring-[#0A7C80]/15">
                <textarea
                  ref={inputRef}
                  rows={1}
                  aria-label="Message Arya"
                  className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-[#8A93A0]"
                  placeholder={replyTo ? "Your answer…" : "e.g. 4 days in Munnar with my wife, slow pace, love tea and views"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={!draft.trim() || send.isPending}
                  className="grid size-10 flex-none place-items-center rounded-full bg-[#22DDE0] text-[#072338] transition hover:bg-[#14C9CC] disabled:opacity-40"
                >
                  <ArrowRight className="size-5" />
                </button>
              </div>
            </form>
            <div className="flex items-center gap-1 px-4 pb-3 text-[12.5px]">
              {(
                [
                  ["saved", "Saved places", Bookmark, saved.data?.length],
                  ["help", "Get help", LifeBuoy, undefined],
                ] as const
              ).map(([key, label, Icon, count]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tray === key}
                  onClick={() => {
                    setTray((t) => (t === key ? null : key));
                    if (key !== "help") return;
                    setHelpNotice(null);
                    const title = sessions.data?.find((s) => s.id === activeId)?.title;
                    if (title && !helpSubject.trim()) setHelpSubject(`Question about ${title}`.slice(0, 255));
                  }}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold",
                    tray === key ? "bg-[#DCF8F9] text-[#0A6B6E]" : "text-[#566E85] hover:bg-[#F3F6F9]",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                  {count ? <span className="text-[#566E85]">({count})</span> : null}
                </button>
              ))}
            </div>
          </div>
        </section>

        <TripBoard
          state={state as Record<string, unknown>}
          plan={boardPlan}
          showPlan={wide}
          profile={profile.data}
          savedCount={saved.data?.length ?? 0}
          building={!!pending}
        />
      </main>
    </div>
  );
}
