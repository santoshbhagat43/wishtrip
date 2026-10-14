import { cn as clsx } from "@/lib/cn";
import type { ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const control =
  "w-full rounded-xl border-[1.5px] border-border bg-surface px-3 text-sm text-text placeholder:text-muted/70 " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={clsx(control, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(control, "h-10 pr-8", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  // The hint sits outside the <label> so it doesn't become part of the control's name.
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">{label}</span>
        {children}
      </label>
      {error ? (
        <span className="text-xs text-danger" role="alert">{error}</span>
      ) : (
        hint && <span className="text-xs text-muted">{hint}</span>
      )}
    </div>
  );
}

/** Three-state toggle for nullable booleans: unknown / yes / no. */
export function TriState({
  value,
  onChange,
}: {
  value: boolean | null | undefined;
  onChange: (value: boolean | null) => void;
}) {
  const options: [string, boolean | null][] = [
    ["Unknown", null],
    ["Yes", true],
    ["No", false],
  ];
  return (
    <div className="inline-flex rounded-full bg-surface-2 p-0.5">
      {options.map(([label, option]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(option)}
          className={clsx(
            "rounded-full px-3 py-1 text-xs font-semibold",
            (value ?? null) === option ? "bg-surface text-brand shadow-card" : "text-muted hover:text-text",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ChipToggle({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== option) : [...value, option])}
            className={clsx(
              "rounded-full border px-2.5 py-1 text-xs font-medium capitalize",
              on ? "border-brand bg-brand text-on-brand" : "border-border text-muted hover:text-text",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
