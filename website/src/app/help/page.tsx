"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNote, Spinner } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { api, unwrap } from "@/lib/api/client";

export default function HelpPage() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const tickets = useQuery({
    queryKey: ["support-tickets"],
    queryFn: async () => unwrap(await api.GET("/support/tickets")),
  });
  const send = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/support/tickets", {
          body: { subject, body, channel: "in_app", in_destination: false },
        }),
      ),
    onSuccess: () => {
      setSubject("");
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-[34px] leading-tight">Help &amp; support</h1>
      <p className="mt-1 text-muted">Tell us what you need. A WishTrip support agent will pick it up.</p>

      <form
        className="mt-8 space-y-4 rounded-[22px] border border-border bg-surface p-6 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (subject.trim() && body.trim()) send.mutate();
        }}
      >
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} placeholder="e.g. Question about my Kerala trip" />
        </Field>
        <Field label="Message">
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Share the details…" />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="accent" disabled={send.isPending || !subject.trim() || !body.trim()}>
            {send.isPending ? "Sending…" : "Send to support"}
          </Button>
          {send.isSuccess && <span className="text-sm text-ok">Sent — we&apos;ll get back to you.</span>}
        </div>
        <ErrorNote error={send.error} />
      </form>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your recent requests</h2>
        {tickets.isLoading && <Spinner />}
        <ErrorNote error={tickets.error} />
        {tickets.data?.length === 0 && <p className="mt-3 text-sm text-muted">No requests yet.</p>}
        <ul className="mt-3 space-y-2">
          {tickets.data?.map((t) => (
            <li key={t.id} className="rounded-2xl border border-border px-4 py-3 text-sm">
              <span className="font-medium">#{t.number} {t.subject}</span>
              <span className="ml-2 capitalize text-muted">{t.status.replace("_", " ")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
