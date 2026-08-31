"use client";

import { clsx } from "clsx";
import { X } from "lucide-react";
import React, { useEffect } from "react";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

/* ── Card ── */
export function Card({
  className,
  children,
  hover = true,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn("glass rounded-lg", hover && "glass-hover", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── Button ── */
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "positive";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium rounded-md transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-4 py-2 text-sm",
        size === "lg" && "h-11 px-5 text-sm",
        variant === "primary" &&
          "bg-primary text-primary-fg hover:opacity-90 shadow-card font-semibold",
        variant === "secondary" &&
          "bg-surface-3/60 text-text border border-border hover:border-border-strong hover:bg-surface-3",
        variant === "ghost" && "text-text-2 hover:text-text hover:bg-surface-3/50",
        variant === "danger" &&
          "bg-negative/10 text-negative border border-negative/20 hover:bg-negative/20",
        variant === "positive" &&
          "bg-positive/10 text-positive border border-positive/20 hover:bg-positive/20",
        className
      )}
      {...rest}
    />
  );
}

/* ── Badge ── */
export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "positive" | "negative" | "warning" | "info" | "gold";
}) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        tone === "neutral" && "bg-surface-3 text-text-2",
        tone === "positive" && "bg-positive/10 text-positive",
        tone === "negative" && "bg-negative/10 text-negative",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "info" && "bg-chart-2/10 text-chart-2",
        tone === "gold" && "bg-gold/10 text-gold",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ── Inputs ── */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
>(function Input({ className, mono, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/10",
        mono && "num",
        className
      )}
      {...rest}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-primary/50 cursor-pointer",
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 outline-none transition-colors focus:border-primary/50 min-h-[72px]",
        className
      )}
      {...rest}
    />
  );
});

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="label-caps mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

/* ── Modal ── */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full rounded-lg border border-border-strong/40 bg-surface shadow-float animate-scale-in",
          wide ? "max-w-3xl" : "max-w-lg"
        )}
        style={{ background: "var(--glass-bg)", backdropFilter: "blur(32px)" }}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-text-3 hover:bg-surface-3 hover:text-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ── Stat delta chip ── */
export function Delta({ value, invert = false }: { value: number; invert?: boolean }) {
  if (!isFinite(value) || value === 0)
    return <Badge tone="neutral">stable</Badge>;
  const good = invert ? value < 0 : value > 0;
  return (
    <Badge tone={good ? "positive" : "negative"}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </Badge>
  );
}

/* ── Progress bar ── */
export function Progress({
  value,
  tone = "primary",
  className,
}: {
  value: number; // 0..1
  tone?: "primary" | "positive" | "negative" | "warning" | "gold";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-700",
          tone === "primary" && "bg-primary",
          tone === "positive" && "bg-positive",
          tone === "negative" && "bg-negative",
          tone === "warning" && "bg-warning",
          tone === "gold" && "bg-gold"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── Empty state ── */
export function Empty({ icon, title, sub }: { icon?: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="text-text-3 mb-1">{icon}</div>}
      <p className="text-sm font-medium text-text-2">{title}</p>
      {sub && <p className="text-xs text-text-3 max-w-sm">{sub}</p>}
    </div>
  );
}

/* ── Toast (imperative, simple) ── */
type Toast = { id: number; msg: string; tone: "success" | "error" | "info" };
let pushToast: ((t: Omit<Toast, "id">) => void) | null = null;

export function toast(msg: string, tone: Toast["tone"] = "success") {
  pushToast?.({ msg, tone });
}

export function Toaster() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setToasts((cur) => [...cur, { ...t, id }]);
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 3600);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "glass animate-scale-in rounded-md px-4 py-3 text-sm font-medium shadow-float min-w-[240px]",
            t.tone === "success" && "border-positive/30 text-positive",
            t.tone === "error" && "border-negative/30 text-negative",
            t.tone === "info" && "text-text"
          )}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
