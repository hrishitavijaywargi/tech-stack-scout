import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { SettingsForm } from "@/components/SettingsForm";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, CardHeader, PageHeader, Skeleton } from "@/components/ui";
import { getSettings } from "@/lib/data";
import { configStatus } from "@/lib/env";
import { formatDate, relativeTime } from "@/lib/format";
import { getConnectionStatus } from "@/lib/health";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

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

export default async function SettingsPage() {
  const res = await safeLoad(getSettings);
  const cfg = configStatus();
  return (
    <>
      <PageHeader title="Settings" description="Refresh schedule, research preferences and API connections. Secrets are never shown here." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {res.error !== null ? (
            <SetupNotice error={res.error} />
          ) : (
            <>
              <Card>
                <CardHeader title="Weekly automatic refresh" />
                <div className="space-y-2 px-5 py-4 text-sm text-slate-700">
                  <p>
                    Every active company is re-researched <strong>{res.data.refresh_interval_days} days</strong> after its last run, on the server — whether or not anyone has the app open.
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-600">
                    <li>
                      <strong>Supabase pg_cron</strong> calls <code className="rounded bg-slate-100 px-1">/api/cron/refresh</code> every 10 minutes (set up with <code>supabase/scheduler.sql</code>).
                    </li>
                    <li>
                      <strong>Vercel Cron</strong> calls the same endpoint every Monday 02:00 UTC as a backup trigger (<code>vercel.json</code>).
                    </li>
                    <li>Both are authenticated with CRON_SECRET and reuse the manual research pipeline, 4 companies at a time.</li>
                  </ul>
                  <p className="text-slate-600">
                    Last scheduler run:{" "}
                    {res.data.last_scheduler_run_at ? (
                      <>
                        {relativeTime(res.data.last_scheduler_run_at)} ({formatDate(res.data.last_scheduler_run_at, true)}) · queued {String(res.data.last_scheduler_result?.queued ?? 0)}
                      </>
                    ) : (
                      <Badge tone="amber">never — configure the scheduler (README)</Badge>
                    )}
                  </p>
                </div>
              </Card>
              <Card>
                <CardHeader title="Research preferences" />
                <SettingsForm settings={res.data} />
              </Card>
            </>
          )}
        </div>
        <div className="space-y-6">
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
              <p>Single-user workspace for one account executive. Data lives in your Supabase project; the browser never receives database keys.</p>
              <p>
                Access protection:{" "}
                {cfg.basicAuth ? (
                  <Badge tone="green">Basic Auth on</Badge>
                ) : (
                  <Badge tone="amber" className="whitespace-normal">
                    Off — set BASIC_AUTH_USER / BASIC_AUTH_PASSWORD to require a login
                  </Badge>
                )}
              </p>
              <p>
                AI model: <code className="rounded bg-slate-100 px-1">{cfg.geminiModel}</code> (GEMINI_MODEL)
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
