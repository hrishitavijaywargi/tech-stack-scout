import { z } from "zod";
import { fetchWithTimeout, mapLimit, withRetry, HttpError } from "@/lib/http";
import { techByName } from "@/lib/techDictionary";
import { UA } from "@/lib/collectors/common";
import type { DnsInfo, EvidenceItem, SourceRef, SourceStatusEntry } from "@/lib/types";

/**
 * DNS-over-HTTPS (Google Public DNS, no auth): hosting/CDN from CNAME chains and NS, email
 * provider from MX, SaaS tools from TXT domain-verification records and SPF includes.
 * All mapping is table-driven and pure (unit tested); DNS is treated as weak evidence.
 */

const answerSchema = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ name: z.string(), type: z.number(), data: z.string() })).optional(),
});

/** Hosting / CDN providers from CNAME targets and NS hosts. */
export const HOSTING_PATTERNS: { re: RegExp; provider: string }[] = [
  { re: /cloudfront\.net\.?$|amazonaws\.com\.?$|elb\.amazonaws\.com|awsglobalaccelerator\.com|awsdns-/i, provider: "AWS" },
  { re: /googleusercontent\.com|ghs\.googlehosted\.com|\.run\.app\.?$|googlehosted\.com|ns-cloud-[a-e]\d?\.googledomains\.com|appspot\.com/i, provider: "Google Cloud" },
  { re: /azurewebsites\.net|azureedge\.net|trafficmanager\.net|azurefd\.net|cloudapp\.azure\.com|azure-dns\./i, provider: "Microsoft Azure" },
  { re: /vercel-dns\.com|vercel\.app\.?$|cname\.vercel-dns|\.vercel\.com\.?$/i, provider: "Vercel" },
  { re: /netlify\.app\.?$|netlify\.com\.?$|netlifyglobalcdn/i, provider: "Netlify" },
  { re: /herokuapp\.com|herokudns\.com|herokussl\.com/i, provider: "Heroku" },
  { re: /fastly\.net\.?$|fastlylb\.net/i, provider: "Fastly" },
  { re: /akamai|edgekey\.net|akamaiedge\.net|edgesuite\.net/i, provider: "Akamai" },
  { re: /cdn\.cloudflare\.net|\.ns\.cloudflare\.com\.?$/i, provider: "Cloudflare" },
  { re: /fly\.dev\.?$/i, provider: "Fly.io" },
  { re: /digitaloceanspaces|ondigitalocean\.app/i, provider: "DigitalOcean" },
];

export const MX_PATTERNS: { re: RegExp; provider: string }[] = [
  { re: /google\.com\.?$|googlemail\.com\.?$/i, provider: "Google Workspace" },
  { re: /outlook\.com\.?$|protection\.outlook\.com/i, provider: "Microsoft 365" },
  { re: /pphosted\.com/i, provider: "Proofpoint" },
  { re: /mimecast/i, provider: "Mimecast" },
  { re: /amazonses\.com|amazonaws\.com/i, provider: "Amazon SES" },
  { re: /zoho\./i, provider: "Zoho Mail" },
];

/** TXT verification record prefixes → service (≈40). */
export const TXT_VERIFICATIONS: { re: RegExp; service: string }[] = [
  { re: /^google-site-verification=/i, service: "Google" },
  { re: /^MS=ms\d+/i, service: "Microsoft 365" },
  { re: /^atlassian-domain-verification=/i, service: "Atlassian" },
  { re: /^docker-verification=/i, service: "Docker Hub" },
  { re: /^stripe-verification=/i, service: "Stripe" },
  { re: /^apple-domain-verification=/i, service: "Apple Business" },
  { re: /^facebook-domain-verification=/i, service: "Meta Business" },
  { re: /^slack-domain-verification=/i, service: "Slack" },
  { re: /^zoom_?verify|^ZOOM_verify_/i, service: "Zoom" },
  { re: /^hubspot-(developer|domain)-verification=/i, service: "HubSpot" },
  { re: /^adobe-(idp-site|sign)-verification=/i, service: "Adobe" },
  { re: /^docusign=/i, service: "DocuSign" },
  { re: /^okta-verification=/i, service: "Okta" },
  { re: /^(salesforce|pardot)[-_]/i, service: "Salesforce" },
  { re: /^status-page-domain-verification=/i, service: "Statuspage" },
  { re: /^notion-domain-verification=/i, service: "Notion" },
  { re: /^figma-domain-verification=/i, service: "Figma" },
  { re: /^miro-verification=/i, service: "Miro" },
  { re: /^dropbox-domain-verification=/i, service: "Dropbox" },
  { re: /^box-domain-verification=/i, service: "Box" },
  { re: /^canva-site-verification=/i, service: "Canva" },
  { re: /^twilio-domain-verification=/i, service: "Twilio" },
  { re: /^zendesk(verification)?[=-]/i, service: "Zendesk" },
  { re: /^intercom-domain-verification=/i, service: "Intercom" },
  { re: /^postman-domain-verification=/i, service: "Postman" },
  { re: /^(cisco-ci-domain-verification|webexdomainverification)/i, service: "Cisco Webex" },
  { re: /^teamviewer-sso-verification=/i, service: "TeamViewer" },
  { re: /^lastpass-verify/i, service: "LastPass" },
  { re: /^1password-site-verification=/i, service: "1Password" },
  { re: /^knowbe4-site-verification=/i, service: "KnowBe4" },
  { re: /^wiz-domain-verification=/i, service: "Wiz" },
  { re: /^openai-domain-verification=/i, service: "OpenAI" },
  { re: /^anthropic-domain-verification/i, service: "Anthropic" },
  { re: /^jamf-site-verification=/i, service: "Jamf" },
  { re: /^airtable-verification=/i, service: "Airtable" },
  { re: /^segment-site-verification=/i, service: "Segment" },
  { re: /^onetrust-domain-verification=/i, service: "OneTrust" },
  { re: /^globalsign-domain-verification=/i, service: "GlobalSign" },
  { re: /^mailchimp/i, service: "Mailchimp" },
  { re: /^github-verification|^_github-challenge/i, service: "GitHub" },
  { re: /^gitlab-verification/i, service: "GitLab" },
  { re: /^yandex-verification:/i, service: "Yandex" },
  { re: /^pinterest-site-verification=/i, service: "Pinterest" },
];

export const SPF_INCLUDES: { re: RegExp; service: string }[] = [
  { re: /_spf\.google\.com$/i, service: "Google Workspace" },
  { re: /spf\.protection\.outlook\.com$/i, service: "Microsoft 365" },
  { re: /sendgrid\.net$/i, service: "SendGrid" },
  { re: /mailgun\.org$/i, service: "Mailgun" },
  { re: /amazonses\.com$/i, service: "Amazon SES" },
  { re: /mail\.zendesk\.com$/i, service: "Zendesk" },
  { re: /servers\.mcsv\.net$|spf\.mandrillapp\.com$/i, service: "Mailchimp" },
  { re: /_spf\.salesforce\.com$|exacttarget\.com$/i, service: "Salesforce" },
  { re: /mktomail\.com$/i, service: "Marketo" },
  { re: /spf\.mtasv\.net$/i, service: "Postmark" },
  { re: /hubspotemail\.net$|hubspot\.com$/i, service: "HubSpot" },
  { re: /_spf\.atlassian\.net$/i, service: "Atlassian" },
  { re: /stspg-customer\.com$/i, service: "Statuspage" },
  { re: /sparkpostmail\.com$/i, service: "SparkPost" },
  { re: /intercom\.io$/i, service: "Intercom" },
  { re: /freshdesk\.com$/i, service: "Freshdesk" },
];

export const firstMatch = <T extends { re: RegExp }>(table: T[], value: string) => table.find((t) => t.re.test(value)) ?? null;

export function parseTxt(records: string[]) {
  const verifications: DnsInfo["saas_verifications"] = [];
  const spf: DnsInfo["spf_includes"] = [];
  for (const raw of records) {
    const v = raw.replace(/^"|"$/g, "").replace(/"\s*"/g, "");
    const ver = firstMatch(TXT_VERIFICATIONS, v);
    if (ver && !verifications.some((x) => x.service === ver.service)) verifications.push({ service: ver.service, record: v.slice(0, 80) });
    if (/^v=spf1\b/i.test(v)) {
      for (const m of v.matchAll(/include:([^\s]+)/gi)) {
        const domain = m[1].toLowerCase();
        spf.push({ domain, service: firstMatch(SPF_INCLUDES, domain)?.service ?? null });
      }
    }
  }
  return { verifications, spf };
}

async function resolve(name: string, type: string) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await withRetry(async () => {
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/dns-json" }, timeoutMs: 8_000 });
    if (r.status >= 500 || r.status === 429) throw new HttpError(r.status, url, `DNS-over-HTTPS ${r.status}`);
    return r;
  });
  if (!res.ok) return { url, answers: [] as { name: string; type: number; data: string }[] };
  const parsed = answerSchema.safeParse(await res.json());
  return { url, answers: parsed.success ? (parsed.data.Answer ?? []) : [] };
}

export interface DnsCollection {
  dns: DnsInfo;
  evidence: EvidenceItem[];
  sources: SourceRef[];
  status: Omit<SourceStatusEntry, "duration_ms">;
}

export async function collectDns(domain: string): Promise<DnsCollection> {
  const [apexA, wwwA, mx, txt, ns] = await mapLimit(
    [
      [domain, "A"],
      [`www.${domain}`, "A"],
      [domain, "MX"],
      [domain, "TXT"],
      [domain, "NS"],
    ] as const,
    5,
    ([n, t]) => resolve(n, t),
  );

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  const addEvidence = (tech: string, url: string, title: string, text: string) => {
    const def = techByName(tech);
    if (!def) return;
    const ref: SourceRef = { url, type: "dns_record", title, publishedAt: null };
    if (!sources.some((s) => s.url === url)) sources.push(ref);
    evidence.push({ technology: def.name, category: def.category, kind: "dns", source: ref, evidence: text });
  };

  const hosting: DnsInfo["hosting"] = [];
  for (const q of [apexA, wwwA]) {
    for (const a of q.answers.filter((x) => x.type === 5)) {
      const hit = firstMatch(HOSTING_PATTERNS, a.data);
      if (hit && !hosting.some((h) => h.provider === hit.provider && h.host === a.name)) {
        hosting.push({ provider: hit.provider, host: a.name.replace(/\.$/, ""), record: `CNAME ${a.data}` });
        addEvidence(hit.provider, q.url, `DNS ${a.name.replace(/\.$/, "")}`, `${a.name.replace(/\.$/, "")} CNAME → ${a.data.replace(/\.$/, "")}`);
      }
    }
  }
  const nameservers = ns.answers.filter((a) => a.type === 2).map((a) => a.data.replace(/\.$/, ""));
  for (const n of nameservers) {
    const hit = firstMatch(HOSTING_PATTERNS, n);
    if (hit && !hosting.some((h) => h.provider === hit.provider)) {
      hosting.push({ provider: hit.provider, host: domain, record: `NS ${n}` });
      addEvidence(hit.provider, ns.url, `DNS ${domain} NS`, `Nameserver ${n}`);
    }
  }

  const mxHosts = mx.answers.filter((a) => a.type === 15).map((a) => a.data.split(" ").pop()!.replace(/\.$/, ""));
  const email = mxHosts.map((h) => firstMatch(MX_PATTERNS, h)).find(Boolean)?.provider ?? null;
  if (email) addEvidence(email, mx.url, `DNS ${domain} MX`, `MX → ${mxHosts[0]}`);

  const { verifications, spf } = parseTxt(txt.answers.filter((a) => a.type === 16).map((a) => a.data));
  for (const v of verifications) addEvidence(v.service, txt.url, `DNS ${domain} TXT`, `TXT verification record for ${v.service}`);
  for (const s of spf) if (s.service) addEvidence(s.service, txt.url, `DNS ${domain} SPF`, `SPF include:${s.domain} (${s.service})`);

  const dns: DnsInfo = { hosting, email_provider: email, saas_verifications: verifications, spf_includes: spf, nameservers };
  const total = apexA.answers.length + wwwA.answers.length + mx.answers.length + txt.answers.length + ns.answers.length;
  return {
    dns,
    evidence,
    sources,
    status: total
      ? { status: "ok", items: hosting.length + verifications.length + spf.length + (email ? 1 : 0), message: `${hosting.length} hosting/CDN signals, email: ${email ?? "unknown"}, ${verifications.length} SaaS verification records, ${spf.length} SPF includes.` }
      : { status: "not_found", message: `No DNS answers for ${domain}.` },
  };
}
