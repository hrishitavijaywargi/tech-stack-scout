-- Tech Stack Scout — finer technology categories and new evidence sources (DNS, CT logs, web research).
alter type public.finding_category add value if not exists 'containers';
alter type public.finding_category add value if not exists 'iac';
alter type public.finding_category add value if not exists 'cicd';
alter type public.finding_category add value if not exists 'observability';
alter type public.finding_category add value if not exists 'data';
alter type public.finding_category add value if not exists 'saas';

alter type public.source_type add value if not exists 'dns_record';
alter type public.source_type add value if not exists 'certificate_log';
alter type public.source_type add value if not exists 'web_research';

alter table public.research_findings drop constraint if exists research_findings_evidence_kind_check;
alter table public.research_findings add constraint research_findings_evidence_kind_check
  check (evidence_kind in ('code', 'repo_language', 'job_posting', 'article', 'dns', 'subdomain', 'web_research'));

-- Findings from the old 5-category model are re-created on the next research run.
delete from public.research_findings where category = 'infrastructure';
