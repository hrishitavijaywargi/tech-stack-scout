import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from "lucide-react";
import type { ResearchStatus } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ layout

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && <div className="mt-1 text-sm text-slate-500">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-surface shadow-sm", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ buttons

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm disabled:bg-indigo-300",
  secondary: "border border-slate-300 bg-surface text-slate-700 hover:bg-slate-50 shadow-sm disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300",
  danger: "border border-red-200 bg-surface text-red-700 hover:bg-red-50 disabled:text-red-300",
};
const SIZES = { sm: "h-8 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2" };

export function buttonClass(variant: Variant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed whitespace-nowrap",
    VARIANTS[variant],
    SIZES[size],
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button type="button" className={cx(buttonClass(variant, size), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...rest} />;
}

// ------------------------------------------------------------------ badges

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}

export const STATUS_META: Record<ResearchStatus, { label: string; tone: Tone; icon: typeof Clock }> = {
  not_started: { label: "Not Started", tone: "slate", icon: CircleDashed },
  queued: { label: "Queued", tone: "blue", icon: Clock },
  researching: { label: "Researching", tone: "indigo", icon: Loader2 },
  completed: { label: "Completed", tone: "green", icon: CheckCircle2 },
  failed: { label: "Failed", tone: "red", icon: XCircle },
};

export function StatusBadge({ status }: { status: ResearchStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge tone={m.tone}>
      <Icon className={cx("h-3 w-3", status === "researching" && "animate-spin")} aria-hidden />
      {m.label}
    </Badge>
  );
}

export function ConfidenceBadge({ level, score }: { level: "High" | "Medium" | "Low"; score?: number }) {
  const tone: Tone = level === "High" ? "green" : level === "Medium" ? "amber" : "red";
  return (
    <Badge tone={tone} title={score !== undefined ? `Score ${score}/100` : undefined}>
      {level} confidence{score !== undefined ? ` · ${score}` : ""}
    </Badge>
  );
}

// ------------------------------------------------------------------ states

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "amber", title, children }: { tone?: "amber" | "red" | "blue"; title: string; children?: ReactNode }) {
  const styles = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("flex gap-3 rounded-lg border px-4 py-3 text-sm", styles)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 opacity-90">{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200/70", className)} aria-hidden />;
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx("text-indigo-700 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-600", className)}>
      {children}
    </a>
  );
}
