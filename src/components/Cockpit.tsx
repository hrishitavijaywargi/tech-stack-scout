"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Company logo: GitHub org avatar → site favicon → coloured initials. */
export function CompanyLogo({ name, domain, githubOrg, size = 40, className }: { name: string; domain: string; githubOrg: string | null; size?: number; className?: string }) {
  const sources = [
    ...(githubOrg ? [`https://github.com/${encodeURIComponent(githubOrg)}.png?size=${size * 2}`] : []),
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size >= 48 ? 128 : 64}`,
  ];
  const [i, setI] = useState(0);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const box = { width: size, height: size };
  if (i >= sources.length) {
    return (
      <span
        className={cx("flex shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white", className)}
        style={{ ...box, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))` }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[i]}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setI((n) => n + 1)}
      className={cx("shrink-0 rounded-xl bg-white object-contain p-0.5 ring-1 ring-slate-200", className)}
      style={box}
    />
  );
}

/** Circular 0–100 score gauge. */
export function ScoreRing({ value, label, size = 46, hint }: { value: number | null; label: string; size?: number; hint?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color = value === null ? "rgb(var(--slate-300))" : v >= 70 ? "rgb(52 211 153)" : v >= 40 ? "rgb(251 191 36)" : "rgb(var(--slate-400))";
  return (
    <div className="flex flex-col items-center gap-0.5" title={hint ?? `${label}: ${value ?? "—"}/100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${value ?? "not available"}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--slate-200))" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-slate-900 font-semibold" fontSize={size * 0.3}>
          {value ?? "—"}
        </text>
      </svg>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  );
}

/** Accessible tabs; selection is kept in the URL hash so links can open a specific tab. */
export function Tabs({ tabs }: { tabs: { id: string; label: string; count?: number; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (tabs.some((t) => t.id === h)) setActive(h);
  }, [tabs]);
  const select = (id: string) => {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  };
  return (
    <div>
      <div role="tablist" aria-label="Brief sections" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-surface p-1">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
              select(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
            className={cx(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              active === t.id ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px] tabular-nums", active === t.id ? "bg-white/20" : "bg-slate-100 text-slate-500")}>{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="mt-4">
          {t.content}
        </div>
      ))}
    </div>
  );
}
