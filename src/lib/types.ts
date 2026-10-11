/** Shared domain types (safe to import from client and server code). */
import type { Category } from "@/lib/techDictionary";

export type { Category } from "@/lib/techDictionary";
export { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/techDictionary";

export type SourceType =
  | "github_org"
  | "github_repo"
  | "github_release"
  | "job_posting"
  | "engineering_blog"
  | "hacker_news"
  | "dns_record"
  | "certificate_log"
  | "web_research";

/** How a piece of evidence was observed. "code" = a public source file, manifest or CI config. */
export type EvidenceKind = "code" | "repo_language" | "job_posting" | "article" | "dns" | "subdomain" | "web_research";

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  code: "Found in public code",
  repo_language: "GitHub language statistics",
  job_posting: "Mentioned in job posting",
  article: "Mentioned in published article",
  dns: "DNS record",
  subdomain: "Subdomain (certificate log)",
  web_research: "Web research (Gemini + Google Search)",
};

export type Confidence = "high" | "medium" | "low";

export type ResearchStatus = "not_started" | "queued" | "researching" | "completed" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "initial" | "manual" | "bulk" | "scheduled";

export interface SourceRef {
  url: string;
  type: SourceType;
  title: string;
  publishedAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface EvidenceItem {
  technology: string;
  category: Category;
  kind: EvidenceKind;
  source: SourceRef;
  /** Short human-readable quote or description of what was observed. */
  evidence: string;
  detail?: Record<string, unknown>;
}

export interface LanguageShare {
  name: string;
  bytes: number;
  pct: number; // 0..100
  repos: number;
  color: string | null;
}

export interface ReleaseInfo {
  repo: string;
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
}

export type ActivityLevel = "Very active" | "Active" | "Moderate" | "Low" | "No recent public activity" | "Not publicly found";

/** Stored as company_snapshots.activity (snake_case keys follow the documented schema). */
export interface Activity {
  org_url: string | null;
  repos_total: number | null;
  repos_listed: number;
  repos_analyzed: number;
  repos_active_30d: number;
  repos_active_90d: number;
  commits_52w: number[]; // oldest → newest week; [] if unavailable
  commits_90d: number | null;
  commit_repos_sampled: number;
  contributors: number | null;
  releases_90d: number;
  releases: ReleaseInfo[]; // last 180 days
  new_repos_90d: { name: string; url: string; created_at: string }[];
  most_active_repos: { name: string; url: string; pushed_at: string; commits_52w: number | null }[];
  last_push_at: string | null;
  level: ActivityLevel;
  level_reason: string;
}

export interface Hiring {
  provider: "greenhouse" | "lever" | "ashby" | null;
  slug: string | null;
  board_url: string | null;
  total_open_roles: number;
  eng_open_roles: number;
  previous_eng_open_roles: number | null;
  tech_mentions: { tech: string; count: number; category: Category }[];
  sample_roles: { title: string; url: string; team: string | null; techs: string[] }[];
}

export interface DnsInfo {
  hosting: { provider: string; host: string; record: string }[];
  email_provider: string | null;
  saas_verifications: { service: string; record: string }[];
  spf_includes: { domain: string; service: string | null }[];
  nameservers: string[];
}

export interface Subdomains {
  count: number;
  tooling: { subdomain: string; tool: string; tech: string | null }[];
}

export interface HnStory {
  title: string;
  url: string;
  points: number;
  date: string;
  hn_url: string;
}

export interface BlogPost {
  title: string;
  link: string;
  date: string | null;
  snippet: string;
  technical: boolean;
}

export interface WebResearch {
  findings: { title: string; summary: string; date: string | null; url: string | null; type: string }[];
  citations: { uri: string; title: string }[];
  queries: string[];
  model: string | null;
}

export interface SourceStatusEntry {
  status: "ok" | "not_found" | "error" | "skipped";
  message: string;
  duration_ms: number;
  items?: number;
  url?: string;
}

export type SourceKey = "github" | "jobs" | "dns" | "crtsh" | "hn" | "rss" | "web_research";

export const SOURCE_LABELS: Record<SourceKey, string> = {
  github: "GitHub",
  jobs: "Job postings",
  dns: "DNS (Google Public DNS)",
  crtsh: "Certificate Transparency (crt.sh)",
  hn: "Hacker News",
  rss: "Engineering blog (RSS)",
  web_research: "Web research (Gemini + Google Search)",
};

export type GithubMethod = "user_provided" | "verified_domain" | "name_match_unconfirmed" | "none";

export interface GithubIdentification {
  login: string | null;
  method: GithubMethod;
  profileUrl: string | null;
  displayName: string | null;
  blog: string | null;
  candidates: { login: string; name: string | null; blog: string | null; url: string }[];
  note: string;
}

/** A technology with aggregated evidence. Stored in company_snapshots.infra_signals. */
export interface StackItem {
  id: string; // F1, F2… (stable within a snapshot; used for AI citations)
  tech: string;
  category: Category;
  confidence: Confidence;
  confidenceReason: string;
  strongestKind: EvidenceKind;
  evidenceCount: number;
  kinds: EvidenceKind[];
  firstObservedAt: string;
  lastObservedAt: string | null;
  pct?: number; // languages: share of analyzed code
  evidence: { kind: EvidenceKind; source: string; detail: string; url: string; title: string; date: string | null }[];
}

export interface ScoreComponent {
  name: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScoreBreakdown {
  activity: ScoreComponent[];
  fit: ScoreComponent[];
}

export interface OutreachResult {
  status: "ready" | "insufficient_evidence";
  referencedIds: string[];
  needsVerification: boolean;
  insufficientReason: string;
  suggestedResearch: string[];
}

export interface Interpretation {
  statement: string;
  type: "observation" | "hypothesis";
  supportingIds: string[];
}

export interface TalkingPoint {
  point: string;
  evidence_ids: string[];
}

export interface ConfidenceBreakdown {
  score: number;
  level: "High" | "Medium" | "Low";
  components: { name: string; points: number; max: number; reason: string }[];
  cappedReason: string | null;
}

export type ChangeKind =
  | "new_technology"
  | "not_reobserved"
  | "new_language"
  | "language_shift"
  | "new_release"
  | "new_job_posting"
  | "hiring_change"
  | "new_repository"
  | "activity_change"
  | "github_org_changed";

export interface ChangeItem {
  kind: ChangeKind;
  title: string;
  description: string;
  date: string | null;
  sourceUrl: string | null;
  category?: Category;
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  github_org: string | null;
  detected_github_org: string | null;
  detected_github_org_method: GithubMethod | null;
  job_board_provider: "greenhouse" | "lever" | "ashby" | null;
  job_board_slug: string | null;
  blog_rss_url: string | null;
  notes: string | null;
  is_active: boolean;
  research_status: ResearchStatus;
  last_researched_at: string | null;
  next_refresh_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchJob {
  id: string;
  company_id: string;
  batch_id: string | null;
  run_id: string | null;
  job_type: JobType;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceFactRow {
  id: string;
  type: string;
  text: string;
  url: string | null;
  date: string | null;
}

export interface CompanySnapshot {
  id: string;
  company_id: string;
  job_id: string | null;
  run_id: string | null;
  version: number;
  captured_at: string;
  languages: LanguageShare[];
  recent_languages: LanguageShare[];
  infra_signals: StackItem[];
  activity: Activity;
  hiring: Hiring;
  dns: DnsInfo;
  subdomains: Subdomains;
  hn_stories: HnStory[];
  blog_posts: BlogPost[];
  web_research: WebResearch;
  activity_score: number;
  fit_score: number;
  score_breakdown: ScoreBreakdown;
  confidence: ConfidenceBreakdown;
  source_status: Partial<Record<SourceKey, SourceStatusEntry>>;
  github_identification: GithubIdentification;
  evidence_facts: EvidenceFactRow[];
  limitations: string[];
  missing_information: string[];
  sources_analyzed: number;
  changes: ChangeItem[];
  previous_snapshot_id: string | null;
}

export interface CompanyInsight {
  id: string;
  company_id: string;
  snapshot_id: string;
  summary: string;
  outreach_line: string | null;
  outreach_rationale: string;
  talking_points: TalkingPoint[];
  outreach: OutreachResult;
  interpretations: Interpretation[];
  model: string | null;
  ai_attempts: number | null;
  ai_usage: Record<string, number> | null;
  created_at: string;
}

export interface ProductProfile {
  product_name: string;
  one_liner: string;
  description: string;
  target_languages: string[];
  target_clouds: string[];
  target_signals: string[];
  updated_at: string;
}

export interface AppSettings {
  refresh_interval_days: number;
  max_repos: number;
  include_job_boards: boolean;
  include_blogs: boolean;
  include_hacker_news: boolean;
  last_scheduler_run_at: string | null;
  last_scheduler_result: Record<string, unknown> | null;
  updated_at: string;
}

export interface RefreshRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: "cron" | "manual";
  source: string | null;
  status: "running" | "succeeded" | "partial" | "failed" | "idle";
  companies_queued: number;
  companies_processed: number;
  errors: { company: string; message: string }[];
}
