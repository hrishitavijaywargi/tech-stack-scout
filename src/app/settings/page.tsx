import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ProductProfileForm, SettingsForm } from "@/components/SettingsForm";
import { ResearchScopeButton, RestoreCompanyButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, CardHeader, PageHeader, Skeleton, type Tone } from "@/components/ui";
import { getProductProfile, getSettings, listCompanies, recentRuns } from "@/lib/data";
import { configStatus } from "@/lib/env";
import { formatDate, relativeTime } from "@/lib/format";
import { getConnectionStatus } from "@/lib/health";
import { nextCron } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

const RUN_TONE: Record<string, Tone> = { succeeded: "green", partial: "amber", failed: "red", running: "indigo", idle: "slate" };

async function Connections() {
  const { checks } = await getConnectionStatus();
  return (
    <ul className="divide-y divide-slate-100">
      {checks.map((c) => (
        <li key={c.name} className="flex items-start gap-3 px-5 py-3">
          {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" aria-label="Connected" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-600" aria-label="Not connected" />}
          <div>
            <p className="text-sm font-medium text-slate-900">{c.name}</p>
            <p className="text-xs text-slate-500">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

async function load() {
  const [settings, profile, runs, all] = await Promise.all([getSettings(), getProductProfile(), recentRuns(15), listCompanies({ includeInactive: true })]);
  return { settings, profile, runs, removed: all.filter((c) => !c.is_active) };
}

export default async function SettingsPage() {
  const res = await safeLoad(load);
  const cfg = configStatus();
  return (
    <>
      <PageHeader title="Settings" description="Product profile, refresh schedule, research preferences and run history. Secrets are never shown here." actions={<ResearchScopeButton scope="stale" label="Refresh all stale now" icon="refresh" variant="primary" />} />
      {res.error !== null ? (
        <SetupNotice error={res.error} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="Product profile" description="Nikhil's product. Shapes the fit score and every outreach line." />
              <ProductProfileForm profile={res.data.profile} />
            </Card>

            <Card>
              <CardHeader title="Refresh runs" description="Every scheduled or manual processing run, with errors." />
              {res.data.runs.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Started</th>
                        <th className="px-4 py-2 font-medium">Trigger</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 text-right font-medium">Processed</th>
                        <th className="px-4 py-2 font-medium">Duration</th>
                        <th className="px-4 py-2 font-medium">Errors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {res.data.runs.map((r) => (
                        <tr key={r.id} className="align-top">
                          <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-600" title={formatDate(r.started_at, true)}>
                            {relativeTime(r.started_at)}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600">
                            {r.trigger}
                            {r.source ? ` · ${r.source}` : ""}
                          </td>
                          <td className="px-4 py-2">
                            <Badge tone={RUN_TONE[r.status] ?? "slate"}>{r.status}</Badge>
                          </td>
                          <td className="px-4 py-2 text-right text-xs tabular-nums text-slate-600">
                            {r.companies_processed}/{r.companies_queued}
                          </td>
                          <td className="px-4 py-2 text-xs tabular-nums text-slate-600">{r.finished_at ? `${Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)}s` : "—"}</td>
                          <td className="max-w-xs px-4 py-2 text-xs text-red-700">
                            {r.errors.slice(0, 3).map((e, i) => (
                              <p key={i}>
                                <span className="font-medium">{e.company}:</span> {e.message}
                              </p>
                            ))}
                            {r.errors.length > 3 && <p>+{r.errors.length - 3} more</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-5 py-4 text-sm text-slate-500">No runs yet.</p>
              )}
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                Per-company job detail and retries: <Link href="/activity" className="text-indigo-700 hover:underline">Research activity</Link>.
              </p>
            </Card>

            <Card>
              <CardHeader title="Research preferences" />
              <SettingsForm settings={res.data.settings} />
            </Card>

            {res.data.removed.length > 0 && (
              <Card>
                <CardHeader title="Removed from watchlist" description="Inactive companies are not refreshed. Their history is kept." />
                <ul className="divide-y divide-slate-100">
                  {res.data.removed.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <Link href={`/company/${c.id}`} className="text-sm text-slate-800 hover:text-indigo-700">
                        {c.name} <span className="text-xs text-slate-500">{c.domain}</span>
                      </Link>
                      <RestoreCompanyButton id={c.id} name={c.name} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Weekly refresh schedule" />
              <div className="space-y-2 px-5 py-4 text-sm text-slate-700">
                <p>
                  Each active company is re-researched <strong>{res.data.settings.refresh_interval_days} days</strong> after its last snapshot, on the server.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                  <li>
                    Vercel Cron weekly — Mon 06:00 UTC (next {relativeTime(nextCron(0, 6, 1))})
                  </li>
                  <li>Vercel Cron daily — 07:00 UTC, drains anything older than 7 days (next {relativeTime(nextCron(0, 7, null))})</li>
                  <li>Supabase pg_cron — every 10 min: new rows added in Supabase, retries, chained batches</li>
                </ul>
                <p className="text-xs text-slate-500">
                  Last scheduler call:{" "}
                  {res.data.settings.last_scheduler_run_at ? (
                    <>
                      {relativeTime(res.data.settings.last_scheduler_run_at)} ({String(res.data.settings.last_scheduler_result?.source ?? "cron")}, queued {String(res.data.settings.last_scheduler_result?.queued ?? 0)})
                    </>
                  ) : (
                    "never"
                  )}
                </p>
              </div>
            </Card>
            <Card>
              <CardHeader title="API connections" description="Live check, no secrets displayed." />
              <Suspense
                fallback={
                  <div className="space-y-3 px-5 py-4">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                }
              >
                <Connections />
              </Suspense>
            </Card>
            <Card>
              <CardHeader title="Account" />
              <div className="space-y-2 px-5 py-4 text-sm text-slate-600">
                <p>Single-user workspace. Data lives in Supabase; the browser never receives database keys.</p>
                <p>
                  Password gate: {cfg.passwordGate ? <Badge tone="green">on (APP_PASSWORD)</Badge> : <Badge tone="amber" className="whitespace-normal">off — set APP_PASSWORD</Badge>}
                </p>
                <p>
                  AI: <code className="rounded bg-slate-100 px-1">{cfg.geminiModel}</code>, fallback <code className="rounded bg-slate-100 px-1">{cfg.geminiFallbackModel}</code>; web research {cfg.webResearch ? "on" : "off"}.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
