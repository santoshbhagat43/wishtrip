"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, unwrap, type Schemas } from "@/lib/api/client";

type Row = Schemas["MatchRow"];
type State = Row["state"];

const PAGE = 30;
const STATE: Record<State, { label: string; tone: "ok" | "warn" | "neutral" | "info" | "danger"; hint: string }> = {
  review: { label: "Needs review", tone: "warn", hint: "A likely match. Confirm it, or pick another hotel." },
  nomatch: { label: "No match", tone: "danger", hint: "Nothing close in the TripJack catalogue yet." },
  matched: { label: "Matched", tone: "ok", hint: "Matched by name. Its photo is shown." },
  confirmed: { label: "Confirmed", tone: "info", hint: "Chosen by staff. Its photo is shown." },
  unlinked: { label: "No hotel fits", tone: "neutral", hint: "Staff said none fits. Nothing is shown." },
};

/** Which TripJack hotel each creator-trip stay is. Photos are shown only for matched or confirmed
 *  stays; the rest wait here for a person to decide. */
export default function HotelMatchesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"" | State>("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<Row | null>(null);

  const list = useQuery({
    queryKey: ["hotel-matches", page, state, q],
    queryFn: async () =>
      unwrap(await api.GET("/hotel-matches", { params: { query: { state: state || undefined, q: q || undefined, page, page_size: PAGE } } })),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["hotel-matches"] });
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "unlink" | "reset" }) =>
      unwrap(await api.POST(action === "unlink" ? "/hotel-matches/{match_id}/unlink" : "/hotel-matches/{match_id}/reset", { params: { path: { match_id: id } } })),
    onSuccess: refresh,
  });
  const confirm = useMutation({
    mutationFn: async ({ id, hotel }: { id: string; hotel: string }) =>
      unwrap(await api.PUT("/hotel-matches/{match_id}", { params: { path: { match_id: id } }, body: { hotel_id: hotel } })),
    onSuccess: () => {
      setPicking(null);
      refresh();
    },
  });
  const counts = list.data?.counts;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Hotel matches"
        description="Which TripJack hotel each stay in a creator's trip is. A photo is shown to travellers only when the match is confident or you confirm it."
      />
      {counts && (
        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(STATE) as State[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setState(state === s ? "" : s); setPage(1); }}
              className={`rounded-full border px-3 py-1.5 text-sm ${state === s ? "border-brand bg-brand-soft font-semibold" : "border-border bg-surface hover:bg-surface-2"}`}
            >
              {STATE[s].label} <span className="tabular-nums text-muted">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      <Card>
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border p-4"
          onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); setPage(1); }}
        >
          <Select className="w-auto" value={state} onChange={(e) => { setState(e.target.value as "" | State); setPage(1); }} aria-label="State">
            <option value="">All stays</option>
            {(Object.keys(STATE) as State[]).map((s) => <option key={s} value={s}>{STATE[s].label}</option>)}
          </Select>
          <Input className="min-w-[220px] flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search a stay, a trip or a hotel…" aria-label="Search" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4"><ErrorNote error={list.error} /></div>
        ) : list.data!.items.length === 0 ? (
          <p className="m-0 p-8 text-center text-sm text-muted">No stays here. Stays appear as creators&apos; trips name a hotel.</p>
        ) : (
          <>
            <Table>
              <thead><tr><Th>Stay in the trip</Th><Th>TripJack hotel</Th><Th>Match</Th><Th /></tr></thead>
              <tbody>
                {list.data!.items.map((r) => (
                  <tr key={r.id} data-testid={`match-${r.id}`}>
                    <Td>
                      <strong className="block">{r.stay_name}</strong>
                      <span className="text-xs text-muted">{r.trip_title}{r.destination ? ` · ${r.destination}` : ""}</span>
                    </Td>
                    <Td>
                      {r.hotel ? (
                        <span className="flex items-center gap-3">
                          {r.hotel.hero_image ? (
                            // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
                            <img src={r.hotel.hero_image} alt="" className="h-12 w-16 flex-none rounded-lg object-cover" loading="lazy" />
                          ) : (
                            <span className="h-12 w-16 flex-none rounded-lg bg-surface-2" />
                          )}
                          <span className="min-w-0">
                            <span className="block font-medium">{r.hotel.name}</span>
                            <span className="text-xs text-muted">{[r.hotel.city, r.hotel.country].filter(Boolean).join(", ")}</span>
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                      {r.hotel && r.state !== "unlinked" && <span className="ml-2 text-xs tabular-nums text-muted">{Math.round(r.score * 100)}%</span>}
                      {r.decided_by && <span className="block text-xs text-muted">by {r.decided_by}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <span className="flex justify-end gap-1.5">
                        {r.hotel && (r.state === "review" || r.state === "matched") && (
                          <Button size="sm" variant="accent" disabled={confirm.isPending} onClick={() => confirm.mutate({ id: r.id, hotel: r.hotel!.id })}>
                            Confirm
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => setPicking(r)}>Change</Button>
                        {r.state !== "unlinked" && (
                          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: "unlink" })}>No hotel fits</Button>
                        )}
                        {(r.state === "confirmed" || r.state === "unlinked") && (
                          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: "reset" })}>Match again</Button>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ErrorNote error={act.error ?? confirm.error} />
      {picking && <Picker row={picking} busy={confirm.isPending} onClose={() => setPicking(null)} onPick={(hotel) => confirm.mutate({ id: picking.id, hotel })} />}
    </div>
  );
}

/** Pick the hotel a stay really is: the likeliest ones, or search the catalogue by name. */
function Picker({ row, busy, onClose, onPick }: { row: Row; busy: boolean; onClose: () => void; onPick: (hotelId: string) => void }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const found = useQuery({
    queryKey: ["hotel-candidates", row.id, q],
    queryFn: async () =>
      unwrap(await api.GET("/hotel-matches/{match_id}/candidates", { params: { path: { match_id: row.id }, query: { q: q || undefined } } })),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Choose the hotel" className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="m-0 text-base font-semibold">Which hotel is “{row.stay_name}”?</h2>
            <p className="m-0 mt-0.5 text-sm text-muted">{row.trip_title}{row.destination ? ` · ${row.destination}` : ""}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <form className="flex gap-2 border-b border-border p-4" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); }}>
          <Input className="flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search the TripJack hotels by name…" aria-label="Hotel name" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <div className="overflow-y-auto">
          {found.isLoading ? (
            <Spinner />
          ) : found.error ? (
            <div className="p-4"><ErrorNote error={found.error} /></div>
          ) : found.data!.length === 0 ? (
            <p className="m-0 p-8 text-center text-sm text-muted">No hotel with a photo looks like that. If the destination&rsquo;s hotels haven&rsquo;t been fetched yet, they will appear once they are.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {found.data!.map((c) => (
                <li key={c.hotel.id} className="flex items-center gap-3 px-5 py-3">
                  {c.hotel.hero_image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- TripJack hotel photo
                    <img src={c.hotel.hero_image} alt="" className="h-14 w-20 flex-none rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="h-14 w-20 flex-none rounded-lg bg-surface-2" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{c.hotel.name}</span>
                    <span className="text-xs text-muted">
                      {[c.hotel.city, c.hotel.country].filter(Boolean).join(", ")}
                      {c.hotel.stars ? ` · ${c.hotel.stars}★` : ""} · {Math.round(c.score * 100)}% alike
                    </span>
                  </span>
                  <Button size="sm" variant="accent" disabled={busy} onClick={() => onPick(c.hotel.id)}>This one</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
