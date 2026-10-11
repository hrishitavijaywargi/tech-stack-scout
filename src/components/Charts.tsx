"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cx } from "@/components/ui";
import type { LanguageShare } from "@/lib/types";

const GRID = "rgb(var(--chart-grid))";
const AXIS = "rgb(var(--slate-500))";
const ACCENT = "rgb(var(--indigo-500))";
const tooltipStyle = {
  contentStyle: { background: "rgb(var(--surface))", border: "1px solid rgb(var(--slate-200))", borderRadius: 8, fontSize: 12, color: "rgb(var(--slate-900))" },
  labelStyle: { color: "rgb(var(--slate-600))" },
  itemStyle: { color: "rgb(var(--slate-900))" },
};
const FALLBACK = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7", "#14b8a6", "#f97316"];
const colorOf = (l: LanguageShare, i: number) => l.color ?? FALLBACK[i % FALLBACK.length];

/** Language mix donut with a recent (180 d) / all-time toggle. */
export function LanguageDonut({ recent, allTime }: { recent: LanguageShare[]; allTime: LanguageShare[] }) {
  const [mode, setMode] = useState<"recent" | "all">(recent.length ? "recent" : "all");
  const src = mode === "recent" ? recent : allTime;
  const top = src.slice(0, 7);
  const other = src.slice(7).reduce((s, l) => s + l.pct, 0);
  const data = [...top.map((l, i) => ({ name: l.name, value: l.pct, color: colorOf(l, i) })), ...(other > 0.5 ? [{ name: "Other", value: Math.round(other * 10) / 10, color: "rgb(var(--slate-300))" }] : [])];
  return (
    <div>
      <div role="tablist" className="mb-2 inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
        {(["recent", "all"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            disabled={m === "recent" && !recent.length}
            onClick={() => setMode(m)}
            className={cx("rounded-md px-2.5 py-1 font-medium disabled:opacity-40", mode === m ? "bg-surface text-slate-900 shadow-sm" : "text-slate-600")}
          >
            {m === "recent" ? "Recent (180 d)" : "All-time"}
          </button>
        ))}
      </div>
      {data.length ? (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-44 w-44 shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="95%" paddingAngle={1} stroke="none" isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v) => `${v}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full space-y-1 text-sm">
            {data.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} aria-hidden />
                  {d.name}
                </span>
                <span className="tabular-nums text-slate-500">{d.value}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Not publicly found</p>
      )}
    </div>
  );
}

/** 52-week commit activity bars (oldest → newest). */
export function CommitBars({ weeks }: { weeks: number[] }) {
  if (!weeks.length) return <p className="text-sm text-slate-400">GitHub had not finished computing commit statistics for this snapshot.</p>;
  const data = weeks.map((v, i) => ({ week: i - weeks.length + 1, commits: v }));
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: AXIS }} tickFormatter={(w: number) => (w === 0 ? "now" : `${w}w`)} interval={12} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgb(var(--slate-100))" }} labelFormatter={(w) => (Number(w) === 0 ? "This week" : `${-Number(w)} weeks ago`)} />
          <Bar dataKey="commits" fill={ACCENT} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars: how many engineering postings mention each technology. */
export function MentionBars({ mentions }: { mentions: { tech: string; count: number }[] }) {
  const data = mentions.slice(0, 12);
  if (!data.length) return <p className="text-sm text-slate-400">No technology mentions in open engineering roles.</p>;
  return (
    <div className="w-full" style={{ height: Math.max(120, data.length * 24) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="tech" width={120} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgb(var(--slate-100))" }} formatter={(v) => [`${v} postings`, "Mentioned in"]} />
          <Bar dataKey="count" fill={ACCENT} radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: "right", fontSize: 10, fill: AXIS }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Scores and engineering roles across saved snapshots. */
export function HistoryChart({ points }: { points: { date: string; activity: number; fit: number; roles: number | null }[] }) {
  if (points.length < 2) return <p className="text-sm text-slate-400">Trends appear after the second snapshot (the next weekly refresh).</p>;
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="roles" orientation="right" tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line yAxisId="score" type="monotone" dataKey="activity" name="Activity score" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line yAxisId="score" type="monotone" dataKey="fit" name="Fit score" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line yAxisId="roles" type="monotone" dataKey="roles" name="Eng roles" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
