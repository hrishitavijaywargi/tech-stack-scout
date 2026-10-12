import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, CheckCircle2, CircleDashed, Globe, Lightbulb, MessageSquareQuote, Sparkles, XCircle } from "lucide-react";
import { CommitBars, HistoryChart, LanguageDonut, MentionBars } from "@/components/Charts";
import { CompanyLogo, ScoreRing, Tabs } from "@/components/Cockpit";
import { CompanyDetailsForm } from "@/components/CompanyDetailsForm";
import { LiveProgress } from "@/components/LiveProgress";
import { CopyButton, DeleteCompanyButton, RefreshCompanyButton, RemoveCompanyButton, RestoreCompanyButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, CardHeader, EmptyState, ExternalLink, Notice, Skeleton, StatusBadge, cx, type Tone } from "@/components/ui";
import { getCompany, insightFor, latestSnapshot, snapshotHistory } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/format";
import { CONFIDENCE_METHOD } from "@/lib/research/analysis";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  SOURCE_LABELS,
  type ChangeItem,
  type Company,
  type CompanyInsight,
  type CompanySnapshot,
  type Confidence,
  type ScoreComponent,
  type SourceKey,
  type StackItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
type History = Awaited<ReturnType<typeof snapshotHistory>>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const res = await safeLoad(() => getCompany(id));
  return { title: res.data?.name ?? "Company" };
}

const CONF_TONE: Record<Confidence, Tone> = { high: "green", medium: "blue", low: "amber" };
const CHANGE_TONE: Record<ChangeItem["kind"], Tone> = {
  new_technology: "green",
  new_language: "green",
  new_job_posting: "blue",
  hiring_change: "blue",
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
  new_job_posting: "Hiring signal",
  hiring_change: "Hiring",
  new_release: "Release",
  new_repository: "New repo",
  language_shift: "Shift",
  activity_change: "Activity",
  github_org_changed: "Identification",
  not_reobserved: "Not re-observed",
};
const STATUS_ICON = { ok: CheckCircle2, not_found: CircleDashed, error: XCircle, skipped: CircleDashed } as const;
const STATUS_COLOR = { ok: "text-emerald-600", not_found: "text-amber-600", error: "text-red-600", skipped: "text-slate-400" } as const;
const H3 = "text-xs font-semibold uppercase tracking-wide text-slate-500";

export default async function CompanyPage({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await safeLoad(async () => {
    const company = await getCompany(id);
    if (!company) return null;
    const [snapshot, history] = await Promise.all([latestSnapshot(id), snapshotHistory(id)]);
    const insight = snapshot ? await insightFor(snapshot.id) : null;
    return { company, snapshot, insight, history };
  });
  if (res.error !== null) return <SetupNotice error={res.error} />;
  if (!res.data) notFound();
  const { company, snapshot, insight, history } = res.data;
  const inFlight = company.research_status === "queued" || company.research_status === "researching";

  return (
    <>
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Accounts
      </Link>

      <CallSheetHeader company={company} snapshot={snapshot} insight={insight} />
      <LiveProgress compact />

      {company.research_status === "failed" && company.last_error && (
        <div className="mb-6">
          <Notice tone="red" title="The last research run failed">
            {company.last_error}. {snapshot ? `Showing the previous snapshot (v${snapshot.version}).` : "Use Retry to run it again."}
          </Notice>
        </div>
      )}
      {inFlight && snapshot && (
        <div className="mb-6">
          <Notice tone="blue" title="Refresh in progress">
            Showing snapshot v{snapshot.version} until the new research finishes.
          </Notice>
        </div>
      )}

      {!snapshot ? (
        inFlight ? (
          <BriefSkeleton />
        ) : (
          <Card>
            <EmptyState
              title={company.research_status === "failed" ? "No brief yet — research failed" : "Not researched yet"}
              description="Run research to collect public evidence and generate the engineering summary and outreach opening."
              action={company.is_active ? <RefreshCompanyButton id={company.id} label="Research now" status={company.research_status} /> : undefined}
            />
          </Card>
        )
      ) : (
        <Brief snapshot={snapshot} insight={insight} history={history} />
      )}

      <Card className="mt-6">
        <CardHeader title="Company sources" description="Only the domain is required. A confirmed GitHub org, job board and blog feed give better evidence; changes apply on the next refresh." />
        <CompanyDetailsForm company={company} />
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <DeleteCompanyButton id={company.id} name={company.name} />
        </div>
      </Card>
    </>
  );
}

function CallSheetHeader({ company, snapshot, insight }: { company: Company; snapshot: CompanySnapshot | null; insight: CompanyInsight | null }) {
  const gh = company.github_org ?? company.detected_github_org;
  return (
    <div className="sticky top-14 z-20 -mx-4 mb-6 border-y border-slate-200 bg-surface/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border lg:top-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <CompanyLogo name={company.name} domain={company.domain} githubOrg={gh} size={48} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{company.name}</h1>
              {company.research_status !== "completed" && <StatusBadge status={company.research_status} />}
              {!company.is_active && <Badge>Removed</Badge>}
              {snapshot && (
                <Badge tone={snapshot.confidence.level === "High" ? "green" : snapshot.confidence.level === "Medium" ? "amber" : "red"} title={`Research confidence ${snapshot.confidence.score}/100`}>
                  {snapshot.confidence.level} confidence
                </Badge>
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
              <ExternalLink href={`https://${company.domain}`}>{company.domain}</ExternalLink>
              {gh && <ExternalLink href={`https://github.com/${gh}`}>github.com/{gh}</ExternalLink>}
              {snapshot && (
                <span title={formatDate(snapshot.captured_at, true)}>
                  v{snapshot.version} · refreshed {relativeTime(snapshot.captured_at)}
                  {company.is_active && company.next_refresh_at ? ` · next ${relativeTime(company.next_refresh_at)}` : ""}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {snapshot && (
            <div className="flex gap-2">
              <ScoreRing value={snapshot.fit_score} label="Fit" size={48} />
              <ScoreRing value={snapshot.activity_score} label="Activity" size={48} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {insight?.outreach_line && <CopyButton text={insight.outreach_line} label="Copy opener" />}
            {company.is_active ? (
              <>
                <RefreshCompanyButton id={company.id} size="sm" status={company.research_status} />
                <RemoveCompanyButton id={company.id} name={company.name} redirectTo="/" size="sm" />
              </>
            ) : (
              <RestoreCompanyButton id={company.id} name={company.name} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-12" aria-label="Research in progress">
      <Card className="p-5 lg:col-span-7">
        <p className="mb-4 text-sm text-slate-600">Collecting evidence from 7 public sources, then asking Gemini for the brief…</p>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-11/12" />
        <Skeleton className="mt-2 h-3 w-4/5" />
      </Card>
      <Card className="p-5 lg:col-span-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-3 h-24 w-full" />
      </Card>
    </div>
  );
}

function FactChip({ id, snapshot }: { id: string; snapshot: CompanySnapshot }) {
  const f = snapshot.evidence_facts.find((x) => x.id === id);
  if (!f) return <Badge>{id}</Badge>;
  const chip = (
    <Badge tone="indigo" title={f.text}>
      {id}
    </Badge>
  );
  return f.url ? (
    <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.text}>
      {chip}
    </a>
  ) : (
    chip
  );
}

function Brief({ snapshot: s, insight, history }: { snapshot: CompanySnapshot; insight: CompanyInsight | null; history: History }) {
  const paragraphs = insight?.summary.split(/\n\s*\n/) ?? [];
  const infra = s.infra_signals.filter((x) => x.category !== "language");
  const glance = CATEGORY_ORDER.filter((c) => c !== "language")
    .map((cat) => ({ cat, items: infra.filter((x) => x.category === cat && x.confidence !== "low").slice(0, 5) }))
    .filter((g) => g.items.length);
  const freshChanges = s.changes.filter((c) => c.kind !== "not_reobserved");

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: the call sheet */}
        <div className="space-y-6 lg:col-span-7">
          <section className="relative overflow-hidden rounded-2xl border border-indigo-300 bg-gradient-to-br from-indigo-50 via-surface to-surface p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
                <MessageSquareQuote className="h-4 w-4" aria-hidden /> Your opener
              </h2>
              {insight?.outreach_line && <CopyButton text={insight.outreach_line} label="Copy" />}
            </div>
            {insight?.outreach_line ? (
              <>
                {insight.outreach.needsVerification && (
                  <div className="mt-3">
                    <Notice title="Verify before sending">Relies on a GitHub organization matched by name only — confirm it under Company sources.</Notice>
                  </div>
                )}
                <p className="mt-3 text-balance text-lg font-medium leading-relaxed text-slate-900">“{insight.outreach_line}”</p>
                <p className="mt-3 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">Built on: </span>
                  {insight.outreach_rationale}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  Evidence: {insight.outreach.referencedIds.map((x) => <FactChip key={x} id={x} snapshot={s} />)}
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium text-slate-900">A personalized opening can&apos;t be supported yet.</p>
                <p className="mt-1 text-sm text-slate-600">{insight?.outreach_rationale ?? "No insight was generated for this snapshot."}</p>
                {!!insight?.outreach.suggestedResearch.length && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                    {insight.outreach.suggestedResearch.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {!!insight?.talking_points.length && (
            <Card className="p-5">
              <h2 className={H3}>Talking points</h2>
              <ol className="mt-3 space-y-3">
                {insight.talking_points.map((t, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-700">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{i + 1}</span>
                    <span className="pt-0.5">
                      {t.point}{" "}
                      <span className="inline-flex flex-wrap gap-1 align-middle">
                        {t.evidence_ids.map((x) => (
                          <FactChip key={x} id={x} snapshot={s} />
                        ))}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className={H3}>Engineering context</h2>
              {insight?.model && <span className="text-[11px] text-slate-400">Gemini {insight.model.replace("gemini-", "")} · from cited evidence only</span>}
            </div>
            <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-slate-800">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {!!insight?.interpretations.length && (
              <details className="mt-4 border-t border-slate-100 pt-3">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Observations vs. hypotheses ({insight.interpretations.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {insight.interpretations.map((it, i) => (
                    <li key={i} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:gap-3">
                      <Badge tone={it.type === "observation" ? "green" : "amber"} className="w-fit">
                        {it.type === "observation" ? "Observation" : "Hypothesis (AI)"}
                      </Badge>
                      <span className="text-slate-700">
                        {it.statement}{" "}
                        <span className="inline-flex flex-wrap gap-1 align-middle">
                          {it.supportingIds.map((x) => (
                            <FactChip key={x} id={x} snapshot={s} />
                          ))}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        </div>

        {/* Right: at a glance */}
        <div className="space-y-6 lg:col-span-5">
          <Card className="p-5">
            <h2 className={H3}>Stack at a glance</h2>
            <div className="mt-3">
              <LanguageDonut recent={s.recent_languages} allTime={s.languages} />
            </div>
            <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
              {glance.length ? (
                glance.map((g) => (
                  <div key={g.cat}>
                    <p className="text-[11px] font-medium text-slate-500">{CATEGORY_LABELS[g.cat]}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.items.map((x) => (
                        <Badge key={x.id} tone={CONF_TONE[x.confidence]} title={x.confidenceReason}>
                          {x.tech}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">No medium/high-confidence infrastructure found.</p>
              )}
              <p className="text-[11px] text-slate-400">Green = 2+ independent sources · blue = public code or 3+ postings. Full evidence in the Infra tab.</p>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden /> What&apos;s changed
            </h2>
            {history.length > 1 ? (
              freshChanges.length ? (
                <ChangeList changes={freshChanges.slice(0, 6)} compact />
              ) : (
                <p className="mt-2 text-sm text-slate-500">No new signals since v{history[1].version} ({formatDate(history[1].captured_at)}).</p>
              )
            ) : (
              <p className="mt-2 text-sm text-slate-500">Baseline snapshot. Changes appear after the next weekly refresh.</p>
            )}
            {freshChanges.length > 6 && <p className="mt-2 text-xs text-slate-500">+{freshChanges.length - 6} more in the History tab.</p>}
          </Card>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "code", label: "Code & activity", content: <CodeTab s={s} /> },
          { id: "hiring", label: "Hiring", count: s.hiring.provider ? s.hiring.eng_open_roles : undefined, content: <HiringTab s={s} /> },
          { id: "infra", label: "Infra & tooling", count: infra.length, content: <InfraTab infra={infra} /> },
          { id: "signals", label: "Signals", count: s.blog_posts.length + s.hn_stories.length + s.web_research.findings.length, content: <SignalsTab s={s} /> },
          { id: "dns", label: "DNS & certs", content: <DnsTab s={s} /> },
          { id: "history", label: "History", count: history.length, content: <HistoryTab s={s} history={history} /> },
          { id: "sources", label: "Sources & confidence", content: <SourcesTab s={s} /> },
        ]}
      />
    </div>
  );
}

function ScoreBreakdown({ title, value, components, footer }: { title: string; value: number; components: ScoreComponent[]; footer?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className={H3}>{title}</h3>
        <span className="text-lg font-semibold tabular-nums text-slate-900">{value}/100</span>
      </div>
      <ul className="mt-3 space-y-2">
        {components.map((c) => (
          <li key={c.name}>
            <div className="flex justify-between text-xs">
              <span className="font-medium text-slate-700">{c.name}</span>
              <span className="tabular-nums text-slate-500">
                {c.points}/{c.max}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(c.points / c.max) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{c.detail}</p>
          </li>
        ))}
      </ul>
      {footer && <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">{footer}</p>}
    </Card>
  );
}

function CodeTab({ s }: { s: CompanySnapshot }) {
  const a = s.activity;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className={H3}>Commit activity · 52 weeks</h3>
          {a.org_url && <ExternalLink href={a.org_url} className="text-xs">GitHub</ExternalLink>}
        </div>
        <div className="mt-3">
          <CommitBars weeks={a.commits_52w} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["Public repos", a.repos_total ?? a.repos_listed],
            ["Active 30 d", a.repos_active_30d],
            ["Active 90 d", a.repos_active_90d],
            ["Contributors", a.contributors ?? "—"],
            ["Releases 90 d", a.releases_90d],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-slate-50 p-2.5">
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className={H3}>Recent releases</h4>
            {a.releases.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {a.releases.slice(0, 5).map((r) => (
                  <li key={r.url} className="flex justify-between gap-3">
                    <ExternalLink href={r.url} className="truncate">
                      {r.repo.split("/")[1]} {r.tag}
                    </ExternalLink>
                    <span className="shrink-0 text-xs text-slate-400">{formatDate(r.publishedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-400">No releases in 180 days</p>
            )}
          </div>
          <div>
            <h4 className={H3}>Most recently active repos</h4>
            <ul className="mt-2 space-y-1 text-sm">
              {a.most_active_repos.map((r) => (
                <li key={r.url} className="flex justify-between gap-3">
                  <ExternalLink href={r.url} className="truncate">
                    {r.name.split("/")[1]}
                  </ExternalLink>
                  <span className="shrink-0 text-xs text-slate-400">{relativeTime(r.pushed_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
      <div className="space-y-6">
        <ScoreBreakdown title="Activity score" value={s.activity_score} components={s.score_breakdown.activity} footer={`${a.level}: ${a.level_reason}`} />
        <ScoreBreakdown title="Product fit" value={s.fit_score} components={s.score_breakdown.fit} footer="Against the product profile in Settings." />
      </div>
    </div>
  );
}

function HiringTab({ s }: { s: CompanySnapshot }) {
  const h = s.hiring;
  if (!h.provider) return <Card className="p-5 text-sm text-slate-500">{s.source_status.jobs?.message ?? "No public job board linked."}</Card>;
  const delta = h.previous_eng_open_roles !== null ? h.eng_open_roles - h.previous_eng_open_roles : null;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="p-5 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Briefcase className="h-3.5 w-3.5" aria-hidden /> {h.provider} · {h.slug}
          </h3>
          {h.board_url && <ExternalLink href={h.board_url} className="text-xs">Job board</ExternalLink>}
        </div>
        <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{h.eng_open_roles}</p>
        <p className="text-sm text-slate-500">
          open engineering roles of {h.total_open_roles}
          {delta !== null && (
            <span className={cx("ml-1 font-medium", delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-500")}>
              ({delta > 0 ? "+" : ""}
              {delta} vs previous)
            </span>
          )}
        </p>
        <h4 className={cx(H3, "mt-5")}>Most relevant roles</h4>
        <ul className="mt-2 space-y-2 text-sm">
          {h.sample_roles.map((r) => (
            <li key={r.url}>
              <ExternalLink href={r.url}>{r.title}</ExternalLink>
              {r.techs.length > 0 && <p className="text-xs text-slate-500">{r.techs.join(" · ")}</p>}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5 lg:col-span-3">
        <h3 className={H3}>Technologies named in engineering postings</h3>
        <div className="mt-3">
          <MentionBars mentions={h.tech_mentions} />
        </div>
      </Card>
    </div>
  );
}

function InfraTab({ infra }: { infra: StackItem[] }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-slate-500">Confidence: high = 2+ independent sources · medium = public code/config or 3+ job postings · low = a single weak signal. Click a technology for its evidence.</p>
      <div className="mt-2 grid gap-x-8 md:grid-cols-2">
        {CATEGORY_ORDER.filter((c) => c !== "language").map((cat) => {
          const items = infra.filter((x) => x.category === cat);
          return (
            <div key={cat} className="border-b border-slate-100 py-4">
              <h3 className={H3}>{CATEGORY_LABELS[cat]}</h3>
              {items.length ? (
                <ul className="mt-2 space-y-1">
                  {items.map((x) => (
                    <TechRow key={x.id} item={x} />
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
  );
}

function SignalsTab({ s }: { s: CompanySnapshot }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-5">
        <h3 className={H3}>Engineering blog</h3>
        {s.blog_posts.length ? (
          <ul className="mt-2 space-y-3 text-sm">
            {s.blog_posts.map((p) => (
              <li key={p.link}>
                <ExternalLink href={p.link}>{p.title}</ExternalLink> {p.technical && <Badge tone="indigo">technical</Badge>}
                <p className="text-xs text-slate-500">{formatDate(p.date)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-400">{s.source_status.rss?.message ?? "Not publicly found"}</p>
        )}
      </Card>
      <Card className="p-5">
        <h3 className={H3}>Hacker News</h3>
        {s.hn_stories.length ? (
          <ul className="mt-2 space-y-3 text-sm">
            {s.hn_stories.map((st) => (
              <li key={st.url}>
                <ExternalLink href={st.url}>{st.title}</ExternalLink>
                <p className="text-xs text-slate-500">
                  {st.points} points · {formatDate(st.date)} · <ExternalLink href={st.hn_url}>discussion</ExternalLink>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-400">{s.source_status.hn?.message ?? "Not publicly found"}</p>
        )}
      </Card>
      <Card className="p-5">
        <h3 className={H3}>Web research · Gemini + Google Search</h3>
        {s.web_research.findings.length ? (
          <ul className="mt-2 space-y-3 text-sm">
            {s.web_research.findings.map((f, i) => (
              <li key={i}>
                {f.url ? <ExternalLink href={f.url}>{f.title}</ExternalLink> : f.title} <Badge>{f.type.replace("_", " ")}</Badge>
                <p className="text-xs text-slate-500">
                  {f.summary}
                  {f.date ? ` · ${f.date}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-400">{s.source_status.web_research?.message ?? "Not run"}</p>
        )}
        {!!s.web_research.citations.length && (
          <p className="mt-3 text-xs text-slate-400">
            Grounding sources:{" "}
            {s.web_research.citations.slice(0, 6).map((c, i) => (
              <span key={c.uri}>
                {i > 0 && ", "}
                <ExternalLink href={c.uri}>{c.title}</ExternalLink>
              </span>
            ))}
          </p>
        )}
      </Card>
    </div>
  );
}

function DnsTab({ s }: { s: CompanySnapshot }) {
  return (
    <Card className="p-5">
      <div className="grid gap-6 md:grid-cols-2">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-slate-500">
              <Globe className="h-3.5 w-3.5" aria-hidden /> Hosting / CDN
            </dt>
            <dd className="text-slate-800">{s.dns.hosting.map((x) => `${x.provider} (${x.record})`).join("; ") || "Not found"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email provider</dt>
            <dd className="text-slate-800">{s.dns.email_provider ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">SaaS verification records</dt>
            <dd className="mt-1 flex flex-wrap gap-1">{s.dns.saas_verifications.length ? s.dns.saas_verifications.map((v) => <Badge key={v.service}>{v.service}</Badge>) : <span className="text-slate-400">None</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">SPF includes</dt>
            <dd className="text-slate-800">{s.dns.spf_includes.map((x) => x.service ?? x.domain).join(", ") || "None"}</dd>
          </div>
        </dl>
        <div>
          <p className="text-sm text-slate-800">
            <span className="text-2xl font-semibold tabular-nums">{s.subdomains.count}</span> subdomains in unexpired certificates
          </p>
          {s.subdomains.tooling.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {s.subdomains.tooling.map((t) => (
                <li key={t.subdomain} className="flex justify-between gap-3">
                  <code className="truncate text-xs text-slate-700">{t.subdomain}</code>
                  <span className="shrink-0 text-xs text-slate-500">{t.tool}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-400">{s.source_status.crtsh?.status === "error" ? s.source_status.crtsh.message : "No tooling-revealing subdomains"}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function HistoryTab({ s, history }: { s: CompanySnapshot; history: History }) {
  const points = [...history].reverse().map((p) => ({ date: formatDate(p.captured_at), activity: p.activity_score, fit: p.fit_score, roles: p.eng_open_roles }));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className={H3}>All changes in v{s.version}</h3>
        <p className="mt-1 text-xs text-slate-500">“Newly observed” means first seen in public evidence — not newly adopted. “Not re-observed” never means stopped using.</p>
        {s.changes.length ? <ChangeList changes={s.changes} /> : <p className="mt-2 text-sm text-slate-500">{history.length > 1 ? "No differences from the previous snapshot." : "First snapshot."}</p>}
      </Card>
      <Card className="p-5">
        <h3 className={H3}>Trend across snapshots</h3>
        <div className="mt-3">
          <HistoryChart points={points} />
        </div>
        {history.length > 1 && (
          <table className="mt-3 w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 text-left font-medium">Snapshot</th>
                <th className="py-1 text-left font-medium">Top languages (180 d)</th>
                <th className="py-1 text-right font-medium">Eng roles</th>
                <th className="py-1 text-right font-medium">Commits 90 d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {history.map((p) => (
                <tr key={p.id}>
                  <td className="py-1">
                    v{p.version} · {formatDate(p.captured_at)}
                  </td>
                  <td className="py-1">{(p.recent_languages ?? []).slice(0, 3).map((l) => `${l.name} ${l.pct}%`).join(", ") || "—"}</td>
                  <td className="py-1 text-right tabular-nums">{p.eng_open_roles ?? "—"}</td>
                  <td className="py-1 text-right tabular-nums">{p.commits_90d ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function SourcesTab({ s }: { s: CompanySnapshot }) {
  const ident = s.github_identification;
  return (
    <Card className="p-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className={H3}>Source status · {formatDate(s.captured_at, true)}</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {(Object.keys(SOURCE_LABELS) as SourceKey[]).map((k) => {
              const st = s.source_status[k];
              if (!st) return null;
              const Icon = STATUS_ICON[st.status];
              return (
                <li key={k} className="flex gap-2">
                  <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", STATUS_COLOR[st.status])} aria-label={st.status} />
                  <span className="min-w-0 text-slate-700">
                    <span className="font-medium">{SOURCE_LABELS[k]}</span>
                    <span className="text-xs text-slate-400">
                      {" "}
                      · {st.status.replace("_", " ")} · {(st.duration_ms / 1000).toFixed(1)}s
                    </span>
                    <span className="block text-xs text-slate-500">
                      {st.message} {st.url && <ExternalLink href={st.url}>source</ExternalLink>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <h3 className={cx(H3, "mt-5")}>GitHub identification</h3>
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
        </div>
        <div>
          <h3 className={H3}>Research confidence · {s.confidence.level}</h3>
          <table className="mt-2 w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {s.confidence.components.map((c) => (
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
          {s.confidence.cappedReason && <p className="mt-2 text-xs text-amber-700">Level capped: {s.confidence.cappedReason}</p>}
          <details className="mt-2 text-xs text-slate-500">
            <summary className="cursor-pointer">How confidence is scored</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {CONFIDENCE_METHOD.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </details>
          <h3 className={cx(H3, "mt-5")}>Limitations</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
            {s.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
      <details className="mt-5 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Evidence pack given to Gemini ({s.evidence_facts.length} facts)</summary>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {s.evidence_facts.map((f) => (
            <li key={f.id} className="flex gap-2">
              <span className="w-8 shrink-0 font-mono text-slate-400">{f.id}</span>
              <span className="min-w-0 break-words">
                {f.text} {f.date && <span className="text-slate-400">({formatDate(f.date)})</span>} {f.url && <ExternalLink href={f.url}>source</ExternalLink>}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function TechRow({ item }: { item: StackItem }) {
  return (
    <li>
      <details className="group rounded-lg border border-transparent open:border-slate-200 open:bg-slate-50/50 hover:border-slate-200">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-2 py-1.5">
          <span className="text-sm font-medium text-slate-900">{item.tech}</span>
          <Badge tone={CONF_TONE[item.confidence]} title={item.confidenceReason}>
            {item.confidence}
          </Badge>
          <span className="text-xs text-slate-400">{item.evidenceCount} evidence</span>
          <span className="ml-auto text-xs text-indigo-700 group-open:hidden">Evidence</span>
        </summary>
        <ul className="space-y-1.5 px-2 pb-2 pt-1">
          <li className="text-xs text-slate-500">{item.confidenceReason}</li>
          {item.evidence.map((e, i) => (
            <li key={i} className="text-xs text-slate-600">
              <Badge className="mr-1.5">{e.source}</Badge>
              <span className="break-words">{e.detail}</span>{" "}
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline decoration-indigo-200 underline-offset-2">
                source
              </a>
              {e.date && <span className="text-slate-400"> · {formatDate(e.date)}</span>}
            </li>
          ))}
          <li className="text-xs text-slate-400">First observed {formatDate(item.firstObservedAt)}</li>
        </ul>
      </details>
    </li>
  );
}

function ChangeList({ changes, compact }: { changes: ChangeItem[]; compact?: boolean }) {
  return (
    <ul className="mt-2 divide-y divide-slate-100">
      {changes.map((c, i) => (
        <li key={i} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
          <Badge tone={CHANGE_TONE[c.kind]} className="w-fit shrink-0">
            {CHANGE_LABEL[c.kind]}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-900">{c.sourceUrl ? <ExternalLink href={c.sourceUrl}>{c.title}</ExternalLink> : c.title}</p>
            {!compact && <p className="text-xs text-slate-500">{c.description}</p>}
          </div>
          {!compact && <span className="shrink-0 text-xs text-slate-400">{formatDate(c.date)}</span>}
        </li>
      ))}
    </ul>
  );
}
