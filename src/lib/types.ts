/** Shared domain types (safe to import from client and server code). */

export type Category = "language" | "framework" | "cloud" | "infrastructure" | "architecture";

export const CATEGORY_LABELS: Record<Category, string> = {
  language: "Programming languages",
  framework: "Frameworks and libraries",
  cloud: "Cloud platforms",
  infrastructure: "Infrastructure and deployment",
  architecture: "Architecture signals",
};

export const CATEGORY_ORDER: Category[] = ["language", "framework", "cloud", "infrastructure", "architecture"];

export type SourceType =
  | "github_org"
  | "github_repo"
  | "github_release"
  | "job_posting"
  | "engineering_blog"
  | "hacker_news";

/** How strong a piece of evidence is. "code" = found in a public source file or manifest. */
export type EvidenceKind = "code" | "repo_language" | "job_posting" | "article";

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  code: "Found in public code",
  repo_language: "GitHub language statistics",
  job_posting: "Mentioned in job posting",
  article: "Mentioned in published article",
};

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
  share: number; // 0..1
  repos: number;
  topRepo: { name: string; url: string } | null;
}

export interface ReleaseInfo {
  repo: string;
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
}

export type ActivityLevel = "Very active" | "Active" | "Moderate" | "Low" | "No recent public activity" | "Not publicly found";

export interface ActivityMetrics {
  orgUrl: string | null;
  reposTotal: number | null;
  reposListed: number;
  reposAnalyzed: number;
  reposPushed30d: number;
  reposPushed90d: number;
  newRepos90d: { name: string; url: string; createdAt: string }[];
  commits30d: number | null;
  commits30dCapped: boolean;
  committers30d: number | null;
  commitReposSampled: number;
  releases180d: ReleaseInfo[];
  lastPushAt: string | null;
  mostActiveRepos: { name: string; url: string; pushedAt: string; commits30d: number | null }[];
  level: ActivityLevel;
  levelReason: string;
}

export type SourceName = "GitHub" | "Job postings" | "Engineering blog" | "Hacker News" | "Developer talks";

export interface SourceStatus {
  source: SourceName;
  status: "ok" | "not_found" | "error" | "skipped" | "not_collected";
  detail: string;
  items?: number;
  url?: string;
}

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

/** A technology as shown in the report (aggregated evidence). */
export interface StackItem {
  id: string; // F1, F2… (stable within a report; used for AI citations)
  technology: string;
  category: Category;
  strongestKind: EvidenceKind;
  evidenceCount: number;
  sourceTypes: SourceType[];
  firstObservedAt: string;
  lastObservedAt: string | null; // most recent artefact date among the evidence
  share?: number; // languages only
  evidence: { kind: EvidenceKind; text: string; url: string; title: string; date: string | null }[];
}

export interface OutreachResult {
  status: "ready" | "insufficient_evidence";
  line: string;
  relevance: string;
  referencedIds: string[];
  insufficientReason: string;
  suggestedResearch: string[];
  needsVerification: boolean;
}

export interface Interpretation {
  statement: string;
  type: "observation" | "hypothesis";
  supportingIds: string[];
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
  domain: string | null;
  github_org: string | null;
  detected_github_org: string | null;
  detected_github_org_method: GithubMethod | null;
  careers_url: string | null;
  blog_url: string | null;
  watchlist_status: "active" | "paused";
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
  report_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchReport {
  id: string;
  company_id: string;
  job_id: string | null;
  version: number;
  summary_paragraphs: string[];
  tech_stack: StackItem[];
  engineering_activity: ActivityMetrics;
  outreach: OutreachResult;
  interpretations: Interpretation[];
  evidence_facts: { id: string; type: string; text: string; url: string | null; date: string | null }[];
  confidence_level: "High" | "Medium" | "Low";
  confidence_score: number;
  confidence_breakdown: ConfidenceBreakdown;
  limitations: string[];
  missing_information: string[];
  source_statuses: SourceStatus[];
  sources_analyzed: number;
  github_identification: GithubIdentification;
  ai_model: string | null;
  ai_attempts: number | null;
  ai_usage: Record<string, number> | null;
  created_at: string;
}

export interface AppSettings {
  product_name: string;
  product_description: string;
  refresh_interval_days: number;
  max_repos: number;
  include_job_boards: boolean;
  include_blogs: boolean;
  include_hacker_news: boolean;
  last_scheduler_run_at: string | null;
  last_scheduler_result: Record<string, unknown> | null;
  updated_at: string;
}
