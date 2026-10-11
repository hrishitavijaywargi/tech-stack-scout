import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink as ExternalIcon, GitBranch, History, Lightbulb, MessageSquareQuote, ShieldCheck } from "lucide-react";
import { CompanyDetailsForm } from "@/components/CompanyDetailsForm";
import { LiveProgress } from "@/components/LiveProgress";
import { CopyButton, RefreshCompanyButton, RemoveCompanyButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, CardHeader, ConfidenceBadge, EmptyState, ExternalLink, Notice, PageHeader, Skeleton, StatusBadge, cx, type Tone } from "@/components/ui";
import { getCompany, latestReport, reportHistory } from "@/lib/data";
import { formatDate, pct, relativeTime } from "@/lib/format";
import { CONFIDENCE_METHOD } from "@/lib/research/analysis";
import { CATEGORY_LABELS, CATEGORY_ORDER, EVIDENCE_KIND_LABELS, type ChangeItem, type EvidenceKind, type ResearchReport, type StackItem } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const res = await safeLoad(() => getCompany(id));
  return { title: res.data?.name ?? "Company" };
}

const KIND_TONE: Record<EvidenceKind, Tone> = { code: "green", repo_language: "green", job_posting: "blue", article: "slate" };
const CHANGE_TONE: Record<ChangeItem["kind"], Tone> = {
  new_technology: "green",
  new_language: "green",
  new_job_posting: "blue",
  new_release: "indigo",
  new_repository: "indigo",
  language_shift: "amber",
  activity_change: "amber",
  github_org_changed: "amber",
  not_reobserved: "slate",
};
const CHANGE_LABEL: Record<ChangeItem["kind"], string> = {
  new_technology: "Newly observed",
  new_language: "Newly observed",
  new_job_posting: "New posting",
  new_release: "Release",
  new_repository: "New repo",
  language_shift: "Shift",
  activity_change: "Activity",
  github_org_changed: "Identification",
  not_reobserved: "Not re-observed",
};

export default async function CompanyPage({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await safeLoad(async () => {
    const company = await getCompany(id);
    if (!company) return null;
    const [report, history] = await Promise.all([latestReport(id), reportHistory(id)]);
    return { company, report, history };
  });
  if (res.error !== null) return <SetupNotice error={res.error} />;
  if (!res.data) notFound();
  const { company, report, history } = res.data;
  const inFlight = company.research_status === "queued" || company.research_status === "researching";

  return (
    <>
      <Link href="/watchlist" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Watchlist
      </Link>
      <PageHeader
        title={company.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={company.research_status} />
            {company.domain && <ExternalLink href={`https://${company.domain}`}>{company.domain}</ExternalLink>}
            {report && (
              <span>
                Report v{report.version} · researched {formatDate(report.created_at, true)} · next refresh {relativeTime(company.next_refresh_at)}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <RefreshCompanyButton id={company.id} status={company.research_status} />
            <RemoveCompanyButton id={company.id} name={company.name} redirectTo="/watchlist" />
          </>
        }
      />
      <LiveProgress compact />

      {company.research_status === "failed" && company.last_error && (
        <div className="mb-6">
          <Notice tone="red" title="The last research run failed">
            {company.last_error}. {report ? `Showing the previous report (v${report.version}).` : "Use Retry to run it again."}
          </Notice>
        </div>
      )}
      {inFlight && report && (
        <div className="mb-6">
          <Notice tone="blue" title="Refresh in progress">
            Showing report v{report.version} until the new research finishes.
          </Notice>
        </div>
      )}

      {!report ? (
        inFlight ? (
          <ReportSkeleton />
        ) : (
          <Card>
            <EmptyState
              title={company.research_status === "failed" ? "No report yet — research failed" : "Not researched yet"}
              description="Run research to collect public evidence and generate the engineering summary and outreach opening."
              action={<RefreshCompanyButton id={company.id} label="Research now" status={company.research_status} />}
            />
          </Card>
        )
      ) : (
        <Report report={report} history={history} companyName={company.name} />
      )}

      <Card className="mt-6">
        <CardHeader title="Company details" description="Improve identification: a confirmed GitHub organization, website, careers page and blog give better evidence." />
        <CompanyDetailsForm company={company} />
      </Card>
    </>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6" aria-label="Research in progress">
      <Card className="p-5">
        <p className="mb-4 text-sm text-slate-600">Collecting evidence from GitHub, job boards and engineering articles, then asking Gemini for the summary…</p>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-11/12" />
        <Skeleton className="mt-2 h-3 w-4/5" />
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="mt-3 h-6 w-2/3" />
            <Skeleton className="mt-2 h-6 w-1/2" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function FactChip({ id, report }: { id: string; report: ResearchReport }) {
  const f = report.evidence_facts.find((x) => x.id === id);
  if (!f) return <Badge>{id}</Badge>;
  const label = (
    <Badge tone="indigo" title={f.text}>
      {id}
    </Badge>
  );
  return f.url ? (
    <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.text}>
      {label}
    </a>
  ) : (
    label
  );
}

function Report({ report, history, companyName }: { report: ResearchReport; history: { id: string; report_version: number; snapshot_at: string; changes: ChangeItem[] }[]; companyName: string }) {
  const o = report.outreach;
  const ident = report.github_identification;
  const a = report.engineering_activity;
  const latestChanges = history[0]?.changes ?? [];
  const okSources = report.source_statuses.filter((s) => s.status === "ok").length;

  return (
    <div className="space-y-6">
      {/* Outreach */}
      <Card className="border-indigo-200">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <MessageSquareQuote className="h-4 w-4 text-indigo-600" aria-hidden /> Personalized outreach opening
            </span>
          }
          actions={o.status === "ready" ? <CopyButton text={o.line} label="Copy line" /> : null}
        />
        <div className="px-5 py-4">
          {o.status === "ready" ? (
            <>
              {o.needsVerification && (
                <div className="mb-3">
                  <Notice title="Verify before sending">This line relies on a GitHub organization matched by name only. Confirm it under Company details.</Notice>
                </div>
              )}
              <blockquote className="border-l-4 border-indigo-500 pl-4 text-base leading-relaxed text-slate-900">{o.line}</blockquote>
              <p className="mt-3 text-sm text-slate-600">
                <span className="font-medium text-slate-700">Why it&apos;s relevant: </span>
                {o.relevance}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                Based on: {o.referencedIds.map((id) => <FactChip key={id} id={id} report={report} />)}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-900">A personalized opening can&apos;t be supported yet.</p>
              <p className="mt-1 text-sm text-slate-600">{o.insufficientReason}</p>
              {o.suggestedResearch.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {o.suggestedResearch.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader
          title="Engineering context summary"
          description={report.ai_model ? `Written by Gemini (${report.ai_model}) only from the evidence below · ${report.ai_attempts} attempt(s), validated before saving` : "Generated without AI because no evidence was found"}
          actions={<ConfidenceBadge level={report.confidence_level} score={report.confidence_score} />}
        />
        <div className="space-y-3 px-5 py-4 text-[15px] leading-relaxed text-slate-800">
          {report.summary_paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {report.interpretations.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Observations vs. hypotheses
            </h3>
            <ul className="space-y-2">
              {report.interpretations.map((it, i) => (
                <li key={i} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:gap-3">
                  <Badge tone={it.type === "observation" ? "green" : "amber"} className="w-fit">
                    {it.type === "observation" ? "Observation" : "Hypothesis (AI)"}
                  </Badge>
                  <span className="text-slate-700">
                    {it.statement}{" "}
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      {it.supportingIds.map((id) => (
                        <FactChip key={id} id={id} report={report} />
                      ))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Tech stack */}
      <Card>
        <CardHeader title="Technology stack" description="Every item links to the public evidence it came from. Public code is not necessarily representative of the full internal stack." />
        <div className="divide-y divide-slate-100">
          {CATEGORY_ORDER.map((cat) => {
            const items = report.tech_stack.filter((s) => s.category === cat);
            return (
              <div key={cat} className="px-5 py-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{CATEGORY_LABELS[cat]}</h3>
                {items.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {items.map((s) => (
                      <StackRow key={s.id} item={s} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">Not publicly found</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Activity */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-slate-500" aria-hidden /> Recent engineering activity
            </span>
          }
          description={a.levelReason}
          actions={<Badge tone={a.level === "Very active" || a.level === "Active" ? "green" : a.level === "Moderate" ? "amber" : "slate"}>{a.level}</Badge>}
        />
        {a.reposListed > 0 ? (
          <div className="px-5 py-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Repos updated (30 d)", a.reposPushed30d],
                ["Repos updated (90 d)", a.reposPushed90d],
                ["Commits sampled (30 d)", a.commits30d === null ? "—" : `${a.commits30d}${a.commits30dCapped ? "+" : ""}`],
                ["Releases (180 d)", a.releases180d.length],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              {a.reposTotal ?? a.reposListed} public repositories · {a.reposAnalyzed} analyzed in depth · commits sampled from {a.commitReposSampled} most recently active repos
              {a.committers30d ? ` (${a.committers30d} contributors)` : ""} · last push {formatDate(a.lastPushAt)}.{" "}
              {a.orgUrl && <ExternalLink href={a.orgUrl}>GitHub profile</ExternalLink>}
            </p>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent releases</h3>
                {a.releases180d.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {a.releases180d.slice(0, 6).map((r) => (
                      <li key={r.url} className="flex justify-between gap-3">
                        <ExternalLink href={r.url} className="truncate">
                          {r.repo.split("/")[1]} {r.tag}
                        </ExternalLink>
                        <span className="shrink-0 text-xs text-slate-400">{formatDate(r.publishedAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">No releases in the last 180 days</p>
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Most recently active repositories</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {a.mostActiveRepos.map((r) => (
                    <li key={r.url} className="flex justify-between gap-3">
                      <ExternalLink href={r.url} className="truncate">
                        {r.name.split("/")[1]}
                      </ExternalLink>
                      <span className="shrink-0 text-xs text-slate-400">
                        {r.commits30d !== null ? `${r.commits30d} commits · ` : ""}
                        {relativeTime(r.pushedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                {a.newRepos90d.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    New in last 90 days:{" "}
                    {a.newRepos90d.slice(0, 5).map((r, i) => (
                      <span key={r.url}>
                        {i > 0 && ", "}
                        <ExternalLink href={r.url}>{r.name.split("/")[1]}</ExternalLink>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-400">Not publicly found — {a.levelReason}</p>
        )}
      </Card>

      {/* What's changed */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-500" aria-hidden /> What&apos;s changed?
            </span>
          }
          description={
            history.length > 1
              ? `Snapshot v${history[0].report_version} (${formatDate(history[0].snapshot_at, true)}) compared with v${history[1].report_version} (${formatDate(history[1].snapshot_at, true)}). "Newly observed" ≠ newly adopted.`
              : "This is the first snapshot. Changes will appear after the next refresh."
          }
        />
        {history.length > 1 ? (
          latestChanges.length ? (
            <ChangeList changes={latestChanges} />
          ) : (
            <p className="px-5 py-4 text-sm text-slate-500">No meaningful differences between the last two snapshots.</p>
          )
        ) : (
          <p className="px-5 py-4 text-sm text-slate-400">Baseline recorded {formatDate(history[0]?.snapshot_at ?? report.created_at, true)}.</p>
        )}
        {history.length > 2 && (
          <details className="border-t border-slate-100 px-5 py-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Earlier snapshots ({history.length - 2})</summary>
            <div className="mt-2 space-y-3">
              {history.slice(1, -1).map((h) => (
                <div key={h.id}>
                  <p className="text-xs font-medium text-slate-500">
                    v{h.report_version} · {formatDate(h.snapshot_at, true)} · {h.changes.length} changes
                  </p>
                  {h.changes.length > 0 && <ChangeList changes={h.changes} compact />}
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Evidence + confidence */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden /> Evidence and confidence
            </span>
          }
          description={`Researched ${formatDate(report.created_at, true)} · ${report.sources_analyzed} sources analyzed · ${okSources} of ${report.source_statuses.length} source types reached`}
          actions={<ConfidenceBadge level={report.confidence_level} score={report.confidence_score} />}
        />
        <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confidence score</h3>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {report.confidence_breakdown.components.map((c) => (
                  <tr key={c.name}>
                    <td className="py-1.5 pr-3 text-slate-700">{c.name}</td>
                    <td className="py-1.5 pr-3 text-xs text-slate-500">{c.reason}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-900">
                      {c.points}/{c.max}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.confidence_breakdown.cappedReason && <p className="mt-2 text-xs text-amber-700">Level capped: {report.confidence_breakdown.cappedReason}</p>}
            <details className="mt-2 text-xs text-slate-500">
              <summary className="cursor-pointer">How confidence is scored</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {CONFIDENCE_METHOD.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">GitHub identification</h3>
            <p className="mt-1 text-sm text-slate-700">
              {ident.login ? (
                <>
                  <ExternalLink href={ident.profileUrl ?? `https://github.com/${ident.login}`}>{ident.login}</ExternalLink>{" "}
                  <Badge tone={ident.method === "name_match_unconfirmed" ? "amber" : "green"}>
                    {ident.method === "user_provided" ? "Provided" : ident.method === "verified_domain" ? "Verified via website" : "Unconfirmed name match"}
                  </Badge>
                </>
              ) : (
                <Badge>None identified</Badge>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">{ident.note}</p>
            {ident.candidates.length > 0 && ident.method !== "user_provided" && (
              <p className="mt-1 text-xs text-slate-500">
                Candidates considered:{" "}
                {ident.candidates.map((c, i) => (
                  <span key={c.login}>
                    {i > 0 && ", "}
                    <ExternalLink href={c.url}>{c.login}</ExternalLink>
                    {c.blog ? ` (${c.blog})` : ""}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source coverage</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {report.source_statuses.map((s) => (
                <li key={s.source} className="flex gap-2">
                  <Badge tone={s.status === "ok" ? "green" : s.status === "error" ? "red" : s.status === "not_found" ? "amber" : "slate"} className="mt-0.5 h-fit">
                    {s.status.replace("_", " ")}
                  </Badge>
                  <span className="min-w-0 text-slate-700">
                    <span className="font-medium">{s.source}</span> — {s.detail} {s.url && <ExternalLink href={s.url}>source</ExternalLink>}
                  </span>
                </li>
              ))}
            </ul>
            {report.missing_information.length > 0 && (
              <>
                <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Missing information</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {report.missing_information.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Limitations</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {report.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </div>
        <details className="border-t border-slate-100 px-5 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">All evidence given to Gemini ({report.evidence_facts.length} facts)</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {report.evidence_facts.map((f) => (
              <li key={f.id} className="flex gap-2">
                <span className="w-8 shrink-0 font-mono text-slate-400">{f.id}</span>
                <span className="min-w-0 break-words">
                  {f.text} {f.date && <span className="text-slate-400">({formatDate(f.date)})</span>}{" "}
                  {f.url && (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-indigo-700" aria-label={`Open source for ${f.id}`}>
                      <ExternalIcon className="h-3 w-3" />
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </Card>
      <p className="text-center text-xs text-slate-400">
        {companyName} report v{report.version}. Facts come from public sources; text marked as AI or hypothesis is Gemini&apos;s interpretation.
      </p>
    </div>
  );
}

function StackRow({ item }: { item: StackItem }) {
  return (
    <li>
      <details className="group rounded-lg border border-transparent hover:border-slate-200 open:border-slate-200 open:bg-slate-50/50">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-2 py-1.5">
          <span className="font-medium text-slate-900">{item.technology}</span>
          {item.share !== undefined && (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                <span className="block h-full bg-indigo-500" style={{ width: `${Math.max(2, item.share * 100)}%` }} />
              </span>
              <span className="text-xs tabular-nums text-slate-600">{pct(item.share)}</span>
            </span>
          )}
          <Badge tone={KIND_TONE[item.strongestKind]}>{EVIDENCE_KIND_LABELS[item.strongestKind]}</Badge>
          <span className="text-xs text-slate-400">
            {item.evidenceCount} evidence · last seen {item.lastObservedAt ? formatDate(item.lastObservedAt) : "undated"}
          </span>
          <span className="ml-auto text-xs text-indigo-700 group-open:hidden">Evidence</span>
        </summary>
        <ul className="space-y-1.5 px-2 pb-2 pt-1">
          {item.evidence.map((e, i) => (
            <li key={i} className="text-xs text-slate-600">
              <Badge tone={KIND_TONE[e.kind]} className="mr-1.5">
                {EVIDENCE_KIND_LABELS[e.kind]}
              </Badge>
              <span className="break-words">{e.text}</span>{" "}
              <a href={e.url} target="_blank" rel="noopener noreferrer" className={cx("text-indigo-700 underline decoration-indigo-200 underline-offset-2")}>
                {e.title}
              </a>
              {e.date && <span className="text-slate-400"> · {formatDate(e.date)}</span>}
            </li>
          ))}
          <li className="text-xs text-slate-400">First observed by Tech Stack Scout {formatDate(item.firstObservedAt)}</li>
        </ul>
      </details>
    </li>
  );
}

function ChangeList({ changes, compact }: { changes: ChangeItem[]; compact?: boolean }) {
  return (
    <ul className={cx("divide-y divide-slate-100", compact ? "" : "")}>
      {changes.map((c, i) => (
        <li key={i} className={cx("flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3", compact ? "py-1.5" : "px-5 py-3")}>
          <Badge tone={CHANGE_TONE[c.kind]} className="w-fit">
            {CHANGE_LABEL[c.kind]}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-900">
              {c.sourceUrl ? <ExternalLink href={c.sourceUrl}>{c.title}</ExternalLink> : c.title}
              {c.category && <span className="ml-1.5 text-xs text-slate-400">{CATEGORY_LABELS[c.category]}</span>}
            </p>
            {!compact && <p className="text-xs text-slate-500">{c.description}</p>}
          </div>
          <span className="shrink-0 text-xs text-slate-400">{formatDate(c.date)}</span>
        </li>
      ))}
    </ul>
  );
}
