// Verifies no server secret (or its variable name) ends up in browser bundles.
// Run after `npm run build`:  npm run check:bundle
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = ".next/static";
if (!existsSync(dir)) {
  console.error("No .next/static directory — run `npm run build` first.");
  process.exit(1);
}

const names = ["SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN", "CRON_SECRET", "BASIC_AUTH_PASSWORD"];
const values = names.map((n) => process.env[n]).filter((v) => v && v.length >= 8);
const patterns = [/sb_secret_[A-Za-z0-9_-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/, /github_pat_[A-Za-z0-9_]{20,}/, /ghp_[A-Za-z0-9]{30,}/, /"role":"service_role"/];

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(dir);

let problems = 0;
for (const f of files.filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(f, "utf8");
  for (const n of names) if (src.includes(n)) (problems++, console.error(`✗ ${f} references ${n}`));
  for (const v of values) if (src.includes(v)) (problems++, console.error(`✗ ${f} contains the value of a secret env var`));
  for (const p of patterns) if (p.test(src)) (problems++, console.error(`✗ ${f} matches secret pattern ${p}`));
}
console.log(problems ? `${problems} problem(s) found in ${files.length} files` : `✓ No secrets in ${files.length} client bundle files`);
process.exit(problems ? 1 : 0);
