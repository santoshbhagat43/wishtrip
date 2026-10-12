import { cn as clsx } from "@/lib/cn";
import type { ReactNode } from "react";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx("rounded-[22px] border border-border bg-surface shadow-card", className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  action,
}: {
  title: string;
  description?: ReactNode;
  /** Section this screen sits under, shown before the title: "Content / Review queue". */
  breadcrumb?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-[680px] flex-col gap-2">
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="flex gap-1.5 text-[13px] text-muted">
            <span>{breadcrumb}</span>
            <span aria-hidden>/</span>
            <span className="font-semibold text-text">{title}</span>
          </nav>
        )}
        <h1 className="text-[34px] leading-[1.08] text-text">{title}</h1>
        {description && <p className="text-[15px] leading-normal text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** The header's right-hand figures: "23 waiting · Oldest Oct 4". */
export function HeaderStats({ items }: { items: { label: ReactNode; value: ReactNode; tone?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-[18px] text-[13px] tabular-nums text-muted">
      {items.map((item, i) => (
        <span key={i}>
          <strong className={clsx("font-semibold", item.tone ?? "text-text")}>{item.value}</strong> {item.label}
        </span>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-border border-t-brand" />
      {label}
    </div>
  );
}
