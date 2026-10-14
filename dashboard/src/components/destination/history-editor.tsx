"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { api, unwrap, type Location } from "@/lib/api/client";

const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** The written story of a country or city: a one-line summary and its history. */
export function HistoryEditor({ loc }: { loc: Location }) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState(loc.summary ?? "");
  const [history, setHistory] = useState(loc.history ?? "");
  const dirty = summary !== (loc.summary ?? "") || history !== (loc.history ?? "");
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.PATCH("/admin/locations/{location_id}", { params: { path: { location_id: loc.id } }, body: { summary, history } })),
    onSuccess: (updated) => {
      queryClient.setQueryData(["location", loc.id], updated);
      queryClient.invalidateQueries({ queryKey: ["destinations"] });
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="In one line" hint="Shown on cards and lists, e.g. “Beaches · sunsets · easy living”.">
        <Input value={summary} maxLength={500} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field
        label="History"
        hint="Background, culture and what it's known for. The trip planner reads this when it plans a trip here."
      >
        <Textarea
          rows={14}
          value={history}
          onChange={(e) => setHistory(e.target.value)}
          placeholder={`What should a traveller know about ${loc.name}? Its past, its people, why it's worth visiting…`}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="accent" disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save history"}
        </Button>
        {!dirty && save.isSuccess && (
          <span className="flex items-center gap-1 text-sm text-ok">
            <Check className="size-4" /> Saved
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <BookOpenText className="size-3.5" /> {words(history)} words
        </span>
      </div>
      <ErrorNote error={save.error} />
    </form>
  );
}
