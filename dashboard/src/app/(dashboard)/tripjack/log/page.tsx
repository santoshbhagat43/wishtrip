"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, PageHeader, Spinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { copyText } from "@/lib/clipboard";

type Product = "" | "hotels" | "flights" | "insurance";
type Outcome = "all" | "ok" | "failed";

const PAGE = 50;
const stamp = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" });
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const json = (value: unknown) => JSON.stringify(value, null, 2);
const pretty = (text: string) => {
  try {
    return json(JSON.parse(text));
  } catch {
    return text;
  }
};

/** Every call to TripJack, as sent and as answered. Open one for the full request and response;
 *  download the lot as a text log (what TripJack asks for in certification and support). */
export default function TripJackLogPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TripJackLog />
    </Suspense>
  );
}

function TripJackLog() {
  // Arriving from a search result: `?q=<trace id>` shows just the calls behind that answer.
  const arrived = useSearchParams().get("q") ?? "";
  const [page, setPage] = useState(1);
  const [product, setProduct] = useState<Product>("");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [text, setText] = useState(arrived);
  const [q, setQ] = useState(arrived);
  const [open, setOpen] = useState<string | null>(null);

  const filters = { product: product || undefined, outcome, q: q || undefined };
  const list = useQuery({
    queryKey: ["tripjack-logs", page, product, outcome, q],
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await api.GET("/tripjack/logs", { params: { query: { ...filters, page, page_size: PAGE } } })),
  });

  const download = async () => {
    const res = await api.GET("/tripjack/logs/export", { params: { query: { ...filters, limit: 1000 } }, parseAs: "text" });
    const blob = new Blob([String(res.data ?? "")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tripjack-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="TripJack log"
        description="What we send TripJack and what it answers, call by call. The API key is hidden, personal details are redacted, and calls are kept for 14 days."
        action={
          <Button variant="secondary" onClick={download}>
            Download log (.txt)
          </Button>
        }
      />
      <Card>
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(text.trim());
            setPage(1);
          }}
        >
          <Select className="w-auto" value={product} onChange={(e) => { setProduct(e.target.value as Product); setPage(1); }} aria-label="Product">
            <option value="">All products</option>
            <option value="hotels">Hotels</option>
            <option value="flights">Flights</option>
            <option value="insurance">TripSafe</option>
          </Select>
          <Select className="w-auto" value={outcome} onChange={(e) => { setOutcome(e.target.value as Outcome); setPage(1); }} aria-label="Outcome">
            <option value="all">All calls</option>
            <option value="ok">Succeeded</option>
            <option value="failed">Failed</option>
          </Select>
          <Input
            className="min-w-[220px] flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search the path, trace id, error or the answer…"
            aria-label="Search"
          />
          <Button type="submit" variant="secondary">Search</Button>
        </form>

        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4"><ErrorNote error={list.error} /></div>
        ) : list.data!.items.length === 0 ? (
          <p className="m-0 p-8 text-center text-sm text-muted">No calls recorded yet. They appear here as soon as the site talks to TripJack.</p>
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>When</Th><Th>Product</Th><Th>Call</Th><Th>Status</Th><Th className="text-right">Time</Th><Th className="text-right">Size</Th></tr>
              </thead>
              <tbody>
                {list.data!.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => setOpen(c.id)} data-testid={`call-${c.id}`}>
                    <Td className="whitespace-nowrap text-muted">{stamp(c.created_at)}</Td>
                    <Td className="capitalize">{c.product}</Td>
                    <Td>
                      <span className="font-mono text-xs"><b>{c.method}</b> {c.path}</span>
                      {c.error && <span className="block text-xs text-danger">{c.error}</span>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={c.ok ? "ok" : "danger"}>{c.status ?? "no answer"}</Badge>
                      {c.attempts > 1 && <span className="ml-1.5 text-xs text-muted">{c.attempts} tries</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{c.ms} ms</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums text-muted">{size(c.response_bytes)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      {open && <CallDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CallDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const call = useQuery({
    queryKey: ["tripjack-log", id],
    queryFn: async () => unwrap(await api.GET("/tripjack/logs/{log_id}", { params: { path: { log_id: id } } })),
  });
  const c = call.data;
  const [copied, setCopied] = useState("");
  // The whole answer, once asked for (the log shows only the first part of a long one).
  const [full, setFull] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const fetchFull = async () =>
    String((await api.GET("/tripjack/logs/{log_id}/response", { params: { path: { log_id: id } }, parseAs: "text" })).data ?? "");
  const showFull = async () => {
    setLoadingFull(true);
    try {
      setFull(pretty(await fetchFull()));
    } finally {
      setLoadingFull(false);
    }
  };
  const downloadFull = async () => {
    const text = full ?? (await fetchFull());
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tripjack-${c?.product ?? "call"}-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = (label: string, value: string) => {
    copyText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  };
  const request = c ? (c.request_body != null ? json(c.request_body) : c.request_params ? json(c.request_params) : "(no body)") : "";
  const response = full ?? (c ? (c.response_body ? pretty(c.response_body) : "(empty)") : "");

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="TripJack call" className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="m-0 break-all font-mono text-sm font-semibold">{c ? `${c.method} ${c.url}` : "Loading…"}</h2>
            {c && (
              <p className="m-0 mt-1 text-xs text-muted">
                {stamp(c.created_at)} · {c.environment} · {c.ms} ms · {size(c.response_bytes)} · {c.attempts} {c.attempts === 1 ? "try" : "tries"}
                {c.trace_id && <> · trace <code>{c.trace_id}</code></>}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-2">
          {call.error && <ErrorNote error={call.error} />}
          {c && (
            <>
              <Panel title="Request" onCopy={() => copy("request", request)} copied={copied === "request"}>
                <pre className="m-0 mb-2 whitespace-pre-wrap break-all text-xs text-muted">
                  {Object.entries(c.request_headers).map(([k, v]) => `${k}: ${v}\n`)}
                </pre>
                {c.request_params && c.request_body != null && <pre className="m-0 mb-2 text-xs text-muted">query: {json(c.request_params)}</pre>}
                <pre className="m-0 whitespace-pre-wrap break-all text-xs" data-testid="request-body">{request}</pre>
              </Panel>
              <Panel
                title={`Response · ${c.status ?? "no answer"}`}
                tone={c.ok ? "ok" : "danger"}
                onCopy={() => copy("response", response)}
                copied={copied === "response"}
              >
                {c.error && <p className="m-0 mb-2 text-xs text-danger">{c.error}</p>}
                <pre className="m-0 whitespace-pre-wrap break-all text-xs" data-testid="response-body">{response}</pre>
                {c.response_truncated && full === null && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-sans">
                    <p className="m-0 text-xs text-warn">Cut short: showing the first part of {size(c.response_bytes)}.</p>
                    {c.response_full ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={showFull} disabled={loadingFull}>
                          {loadingFull ? "Loading…" : "Show full response"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={downloadFull}>Download (.json)</Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted">The whole answer was not kept for this call (catalogue sync, or logged before this was added).</span>
                    )}
                  </div>
                )}
                {full !== null && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-sans">
                    <p className="m-0 text-xs text-ok">Showing the full response, {size(c.response_bytes)}.</p>
                    <Button size="sm" variant="ghost" onClick={downloadFull}>Download (.json)</Button>
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  tone,
  onCopy,
  copied,
  children,
}: {
  title: string;
  tone?: "ok" | "danger";
  onCopy: () => void;
  copied: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <strong className="text-sm">{title}</strong>
        <span className="flex items-center gap-2">
          {tone && <Badge tone={tone}>{tone === "ok" ? "Succeeded" : "Failed"}</Badge>}
          <Button size="sm" variant="secondary" onClick={onCopy}>{copied ? "Copied" : "Copy"}</Button>
        </span>
      </div>
      <div className="max-h-[60dvh] overflow-auto bg-surface-2/40 p-3 font-mono">{children}</div>
    </section>
  );
}
