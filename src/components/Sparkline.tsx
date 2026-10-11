import { cx } from "@/components/ui";

/** Tiny inline sparkline for the watchlist table (pure SVG, no axes). */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <span className={cx("inline-block h-6 w-24", className)} aria-hidden />;
  const max = Math.max(1, ...values);
  const w = 96;
  const h = 24;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cx("h-6 w-24 overflow-visible", className)} role="img" aria-label="52-week commit trend">
      <polyline points={pts} fill="none" stroke="rgb(var(--indigo-500))" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
