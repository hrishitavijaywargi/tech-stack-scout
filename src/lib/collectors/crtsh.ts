import { z } from "zod";
import { fetchWithTimeout, sleep } from "@/lib/http";
import { techByName } from "@/lib/techDictionary";
import { UA } from "@/lib/collectors/common";
import type { EvidenceItem, SourceRef, SourceStatusEntry, Subdomains } from "@/lib/types";

/**
 * Certificate Transparency logs via crt.sh (no auth). Slow and sometimes unavailable, so it has
 * a hard 25 s timeout, runs only inside the background research job, and its failure never
 * affects the rest of the report.
 */

const rowSchema = z.object({ name_value: z.string() });

/** Subdomain label → internal tool it reveals (and the dictionary technology, if any). */
export const TOOLING: { re: RegExp; tool: string; tech: string | null }[] = [
  { re: /^grafana$/, tool: "Grafana", tech: "Grafana" },
  { re: /^prometheus$/, tool: "Prometheus", tech: "Prometheus" },
  { re: /^kibana$/, tool: "Kibana", tech: "Elastic Stack" },
  { re: /^jenkins$/, tool: "Jenkins", tech: "Jenkins" },
  { re: /^argo-?cd$/, tool: "Argo CD", tech: "Argo CD" },
  { re: /^argo$/, tool: "Argo", tech: "Argo CD" },
  { re: /^(k8s|kube|kubernetes)$/, tool: "Kubernetes", tech: "Kubernetes" },
  { re: /^rancher$/, tool: "Rancher", tech: "Kubernetes" },
  { re: /^sentry$/, tool: "Sentry", tech: "Sentry" },
  { re: /^datadog$/, tool: "Datadog", tech: "Datadog" },
  { re: /^vault$/, tool: "Vault", tech: "HashiCorp Vault" },
  { re: /^consul$/, tool: "Consul", tech: "Consul" },
  { re: /^nomad$/, tool: "Nomad", tech: "Nomad" },
  { re: /^gitlab$/, tool: "GitLab", tech: "GitLab" },
  { re: /^(jira|confluence)$/, tool: "Atlassian (Jira/Confluence)", tech: "Atlassian" },
  { re: /^airflow$/, tool: "Airflow", tech: "Airflow" },
  { re: /^spinnaker$/, tool: "Spinnaker", tech: "Spinnaker" },
  { re: /^harbor$/, tool: "Harbor (container registry)", tech: null },
  { re: /^sonar(qube)?$/, tool: "SonarQube", tech: "SonarQube" },
  { re: /^metabase$/, tool: "Metabase", tech: null },
  { re: /^superset$/, tool: "Superset", tech: null },
  { re: /^status$/, tool: "Status page", tech: null },
  { re: /^api$/, tool: "Public API", tech: null },
  { re: /^graphql$/, tool: "GraphQL endpoint", tech: "GraphQL" },
  { re: /^staging$/, tool: "Staging environment", tech: null },
  { re: /^dev$/, tool: "Dev environment", tech: null },
  { re: /^sandbox$/, tool: "Sandbox environment", tech: null },
];

/** Deduplicate CT entries (split multi-line name_value, drop wildcards) and flag tooling. Pure. */
export function analyzeSubdomains(rows: { name_value: string }[], domain: string): Subdomains & { all: string[] } {
  const set = new Set<string>();
  for (const r of rows) {
    for (const n of r.name_value.split(/\n/)) {
      const name = n.trim().toLowerCase().replace(/\.$/, "");
      if (!name || name.startsWith("*") || name === domain || !name.endsWith(`.${domain}`)) continue;
      set.add(name);
    }
  }
  const all = [...set].sort();
  const tooling: Subdomains["tooling"] = [];
  for (const sub of all) {
    const labels = sub.slice(0, -(domain.length + 1)).split(".");
    for (const label of labels) {
      const hit = TOOLING.find((t) => t.re.test(label));
      if (hit) {
        if (!tooling.some((t) => t.tool === hit.tool)) tooling.push({ subdomain: sub, tool: hit.tool, tech: hit.tech });
        break;
      }
    }
  }
  return { count: all.length, tooling, all };
}

export interface CrtCollection {
  subdomains: Subdomains;
  evidence: EvidenceItem[];
  sources: SourceRef[];
  status: Omit<SourceStatusEntry, "duration_ms">;
}

export async function collectCrtsh(domain: string): Promise<CrtCollection> {
  const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired`;
  // crt.sh is frequently overloaded: one retry after a short pause, 25 s timeout each.
  let body: unknown = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && body === null; attempt++) {
    if (attempt) await sleep(4000);
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 25_000 });
      if (!res.ok) {
        lastError = `crt.sh returned HTTP ${res.status}`;
        continue;
      }
      body = await res.json();
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  if (body === null) throw new Error(`${lastError} (after 2 attempts)`);
  const rows = z.array(rowSchema).safeParse(body);
  if (!rows.success) throw new Error("crt.sh returned an unexpected response");
  const { count, tooling } = analyzeSubdomains(rows.data, domain);

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  const pageUrl = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}`;
  for (const t of tooling) {
    const def = t.tech ? techByName(t.tech) : null;
    if (!def) continue;
    const ref: SourceRef = { url: `${pageUrl}#${t.subdomain}`, type: "certificate_log", title: `Certificate for ${t.subdomain}`, publishedAt: null };
    sources.push(ref);
    evidence.push({ technology: def.name, category: def.category, kind: "subdomain", source: ref, evidence: `Subdomain ${t.subdomain} (certificate transparency log) suggests ${t.tool}` });
  }
  return {
    subdomains: { count, tooling },
    evidence,
    sources,
    status: { status: count ? "ok" : "not_found", items: count, url: pageUrl, message: `${count} subdomains in unexpired certificates; ${tooling.length} reveal tooling or environments.` },
  };
}
