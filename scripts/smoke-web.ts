/** One grounded web-research call:  npx tsx --conditions=react-server --env-file=.env.local scripts/smoke-web.ts Stripe stripe.com */
import { collectWebResearch } from "../src/lib/collectors/webResearch";

const [name = "Stripe", domain = "stripe.com"] = process.argv.slice(2);
collectWebResearch({ name, domain })
  .then((r) => {
    console.log(r.status.message);
    console.log("queries:", r.research.queries.join(" | "));
    for (const f of r.research.findings) console.log(`• [${f.type}] ${f.title} (${f.date}) — ${f.summary.slice(0, 120)}\n    ${f.url?.slice(0, 100)}`);
    console.log(`citations: ${r.research.citations.length}; evidence techs: ${[...new Set(r.evidence.map((e) => e.technology))].join(", ")}`);
  })
  .catch((e) => console.error("FAILED:", e.message));
