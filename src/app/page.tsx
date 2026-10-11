import Link from "next/link";
import { Building2, CalendarClock, CheckCircle2, Clock, Gauge, Target } from "lucide-react";
import { AddCompaniesButton } from "@/components/AddCompaniesDialog";
import { LiveProgress } from "@/components/LiveProgress";
import { ExportButton, ResearchScopeButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, EmptyState, PageHeader, type Tone } from "@/components/ui";
import { WatchlistTable } from "@/components/WatchlistTable";
import { formatDate, relativeTime } from "@/lib/format";
import { watchlistData } from "@/lib/views";

export const dynamic = "force-dynamic";

const RUN_TONE: Record<string, Tone> = { succeeded: "green", partial: "amber", failed: "red", running: "indigo", idle: "slate" };

function Stat({ label, value, hint, icon }: { label: string; value: string | number; hint?: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export default async function WatchlistPage() {
  const res = await safeLoad(watchlistData);
  if (res.error !== null) {
    return (
      <>
        <PageHeader title="Watchlist" />
        <SetupNotice error={res.error} />
      </>
    );
  }
  const { rows, lastRun, nextWeekly, nextDaily } = res.data;
  const researched = rows.filter((r) => r.lastRefreshed);
  const stale = rows.filter((r) => r.stale).length;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  return (
    <>
      <PageHeader
        title="Watchlist"
        description="Pre-call engineering context for every target account — refreshed automatically each week."
        actions={
          <>
            {rows.length > 0 && <ExportButton />}
            {stale > 0 && <ResearchScopeButton scope="stale" label={`Refresh ${stale} stale`} icon="refresh" />}
            <AddCompaniesButton />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-slate-200 bg-surface px-4 py-2.5 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Last refresh run:{" "}
          {lastRun ? (
            <>
              <Badge tone={RUN_TONE[lastRun.status] ?? "slate"}>{lastRun.status}</Badge>
              <span title={formatDate(lastRun.started_at, true)}>
                {relativeTime(lastRun.started_at)} · {lastRun.trigger}
                {lastRun.source ? ` (${lastRun.source})` : ""} · {lastRun.companies_processed} processed
                {lastRun.errors.length ? `, ${lastRun.errors.length} errors` : ""}
              </span>
            </>
          ) : (
            "none yet"
          )}
        </span>
        <span className="flex items-center gap-1.5" title={`Weekly ${formatDate(nextWeekly, true)} · stale check ${formatDate(nextDaily, true)} · new companies are picked up within 10 minutes`}>
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          Next scheduled: weekly refresh {relativeTime(nextWeekly)} (Mon 06:00 UTC) · stale check {relativeTime(nextDaily)}
        </span>
        <Link href="/activity" className="ml-auto font-medium text-indigo-700 hover:underline">
          Research activity →
        </Link>
      </div>

      <LiveProgress />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="Your watchlist is empty"
            description="Add a target account or upload a CSV. You can also insert rows into the Supabase companies table — they are picked up automatically within 10 minutes."
            action={<AddCompaniesButton />}
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Accounts" value={rows.length} hint={`${researched.length} with a current brief`} icon={<Building2 className="h-4 w-4" />} />
            <Stat label="Avg. fit" value={avg(rows.map((r) => r.fitScore)) ?? "—"} hint="product fit score, 0–100" icon={<Target className="h-4 w-4" />} />
            <Stat label="Avg. activity" value={avg(rows.map((r) => r.activityScore)) ?? "—"} hint="engineering momentum, 0–100" icon={<Gauge className="h-4 w-4" />} />
            <Stat label="Fresh" value={`${rows.length - stale}/${rows.length}`} hint={stale ? `${stale} older than 7 days` : "all refreshed this week"} icon={<CheckCircle2 className="h-4 w-4" />} />
          </div>
          <Card>
            <WatchlistTable rows={rows} />
          </Card>
          <div className="mt-3 flex justify-end">
            <ResearchScopeButton scope="all" label="Research all now" icon="play" />
          </div>
        </>
      )}
    </>
  );
}
