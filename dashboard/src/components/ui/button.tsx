import { cn as clsx } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";

const styles: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-strong",
  // Coral is reserved for commit actions (save, create, send).
  accent: "bg-accent text-navy hover:bg-accent-strong shadow-[0_8px_20px_rgba(34,221,224,0.25)]",
  secondary: "border border-border bg-surface text-text hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "border border-danger/40 text-danger hover:bg-danger-soft",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-[background-color,transform] duration-200 ease-brand active:translate-y-px",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4.5 text-sm",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
