import type { Category } from "@/lib/types";

/**
 * Deterministic technology catalog. Every technology in a report comes from one of these
 * rules matching real public evidence — the AI never adds technologies of its own.
 *
 *  - paths: matched against file paths in a repository tree (e.g. Dockerfile, *.tf)
 *  - deps:  matched against a single dependency name parsed from a manifest
 *  - text:  matched against prose (job postings, article titles/summaries) and CI workflow files
 */
export interface TechDef {
  name: string;
  category: Category;
  paths?: RegExp;
  deps?: RegExp;
  text?: RegExp;
}

const T = (name: string, category: Category, rules: Omit<TechDef, "name" | "category">): TechDef => ({
  name,
  category,
  ...rules,
});

const OTHER_LANGS = "(?:Python|Java|Rust|Kotlin|Scala|Ruby|C\\+\\+|TypeScript|Node(?:\\.js)?|Elixir|PHP)";

export const CATALOG: TechDef[] = [
  // ---------------------------------------------------------------- languages (prose only;
  // repository languages come from GitHub's language statistics instead)
  T("Go", "language", {
    text: new RegExp(`\\bGolang\\b|\\bGo\\s*(?:\\/|,|and|or)\\s*${OTHER_LANGS}\\b|\\b${OTHER_LANGS}\\s*(?:\\/|,|and|or)\\s*Go\\b|\\bin Go\\b|\\bGo (?:services|microservices|backend|developer|engineer)`),
  }),
  T("Python", "language", { text: /\bPython\b/ }),
  T("Java", "language", { text: /\bJava\b(?!\s*Script)/ }),
  T("Kotlin", "language", { text: /\bKotlin\b/ }),
  T("Scala", "language", { text: /\bScala\b/ }),
  T("TypeScript", "language", { text: /\bTypeScript\b/ }),
  T("JavaScript", "language", { text: /\bJavaScript\b/ }),
  T("Ruby", "language", { text: /\bRuby\b/ }),
  T("Rust", "language", { text: /\bRust\b(?![- ]?(?:Belt|proof|resistant))/ }),
  T("C#", "language", { text: /\bC#|\bC Sharp\b/i }),
  T("C++", "language", { text: /\bC\+\+/ }),
  T("PHP", "language", { text: /\bPHP\b/ }),
  T("Swift", "language", { text: /\bSwift(?:UI)?\b(?=[^.]{0,80}\b(?:iOS|Xcode|Objective-C)\b)|\b(?:iOS|Objective-C)\b[^.]{0,80}\bSwift(?:UI)?\b/ }),
  T("Elixir", "language", { text: /\bElixir\b/ }),

  // ---------------------------------------------------------------- frameworks & libraries
  T("React", "framework", { deps: /^react$/, text: /\bReact(?:\.js|JS)?\b(?!\s*Native)/ }),
  T("React Native", "framework", { deps: /^react-native$/, text: /\bReact Native\b/i }),
  T("Next.js", "framework", { deps: /^next$/, text: /\bNext\.js\b/i }),
  T("Vue", "framework", { deps: /^vue$|^nuxt$/, text: /\bVue(?:\.js)?\b|\bNuxt\b/ }),
  T("Angular", "framework", { deps: /^@angular\/core$/, text: /\bAngular\b/ }),
  T("Svelte", "framework", { deps: /^svelte$|^@sveltejs\/kit$/, text: /\bSvelte(?:Kit)?\b/ }),
  T("Node.js", "framework", { text: /\bNode(?:\.js|JS)\b/i, paths: /(^|\/)\.nvmrc$/ }),
  T("Express", "framework", { deps: /^express$/, text: /\bExpress(?:\.js)\b/ }),
  T("NestJS", "framework", { deps: /^@nestjs\/core$/, text: /\bNestJS\b/i }),
  T("Django", "framework", { deps: /^django$/, text: /\bDjango\b/ }),
  T("Flask", "framework", { deps: /^flask$/, text: /\bFlask\b/ }),
  T("FastAPI", "framework", { deps: /^fastapi$/, text: /\bFastAPI\b/i }),
  T("Spring Boot", "framework", { deps: /^spring-boot.*|^org\.springframework\.boot$/, text: /\bSpring Boot\b|\bSpring (?:Framework|Cloud|MVC|WebFlux)\b/ }),
  T("Ruby on Rails", "framework", { deps: /^rails$/, text: /\bRuby on Rails\b|\bRails\b(?=[^.]{0,60}\bRuby\b)|\bRuby\b[^.]{0,60}\bRails\b/ }),
  T("Laravel", "framework", { deps: /^laravel\/framework$/, text: /\bLaravel\b/ }),
  T(".NET", "framework", { paths: /\.(csproj|sln)$/, text: /\.NET\b|\bASP\.NET\b/ }),
  T("Gin", "framework", { deps: /^github\.com\/gin-gonic\/gin$/ }),
  T("Echo", "framework", { deps: /^github\.com\/labstack\/echo(\/v\d+)?$/ }),
  T("Fiber", "framework", { deps: /^github\.com\/gofiber\/fiber(\/v\d+)?$/ }),
  T("Tokio", "framework", { deps: /^tokio$/ }),
  T("Axum", "framework", { deps: /^axum$/ }),
  T("Actix", "framework", { deps: /^actix-web$/ }),
  T("Phoenix", "framework", { text: /\bPhoenix (?:framework|LiveView)\b/i }),
  T("GraphQL", "framework", {
    deps: /^graphql$|^@apollo\/server$|^apollo-server.*|^graphene$|^strawberry-graphql$|^github\.com\/99designs\/gqlgen$/,
    paths: /\.(graphql|gql)$/,
    text: /\bGraphQL\b/,
  }),
  T("gRPC", "framework", {
    deps: /^@grpc\/grpc-js$|^grpcio$|^google\.golang\.org\/grpc$|^io\.grpc$|^grpc-.*|^tonic$/,
    paths: /\.proto$/,
    text: /\bgRPC\b/i,
  }),
  T("PyTorch", "framework", { deps: /^torch$/, text: /\bPyTorch\b/i }),
  T("TensorFlow", "framework", { deps: /^tensorflow$/, text: /\bTensorFlow\b/i }),
  T("Apache Spark", "framework", { deps: /^pyspark$|^spark-core.*$/, text: /\bApache Spark\b|\bPySpark\b|\bSpark\b(?=[^.]{0,40}\b(?:Scala|streaming|cluster|SQL)\b)/ }),
  T("Flutter", "framework", { paths: /(^|\/)pubspec\.yaml$/, text: /\bFlutter\b/ }),

  // ---------------------------------------------------------------- cloud platforms
  T("AWS", "cloud", {
    deps: /^aws-sdk$|^@aws-sdk\/.+|^boto3$|^botocore$|^aws-cdk-lib$|^@aws-cdk\/.+|^github\.com\/aws\/aws-sdk-go(-v2)?(\/.*)?$|^software\.amazon\.awssdk$|^aws-.*sdk.*$/,
    paths: /(^|\/)(cdk\.json|samconfig\.toml|template\.ya?ml|buildspec\.ya?ml|appspec\.ya?ml)$|(^|\/)\.ebextensions\//,
    text: /\bAWS\b|\bAmazon Web Services\b|\bEKS\b|\bECS\b|\bCloudFormation\b|aws-actions\//,
  }),
  T("Google Cloud", "cloud", {
    deps: /^@google-cloud\/.+|^google-cloud-.+|^cloud\.google\.com\/go(\/.*)?$|^com\.google\.cloud$|^firebase-admin$/,
    paths: /(^|\/)cloudbuild\.ya?ml$/,
    text: /\bGoogle Cloud\b|\bGCP\b|\bGKE\b|\bBigQuery\b|\bCloud Run\b|google-github-actions\//,
  }),
  T("Microsoft Azure", "cloud", {
    deps: /^@azure\/.+|^azure-.+|^com\.azure$|^github\.com\/Azure\/azure-sdk-for-go(\/.*)?$/,
    paths: /(^|\/)azure-pipelines\.ya?ml$/,
    text: /\bAzure\b|\bAKS\b|azure\/login/,
  }),
  T("Cloudflare", "cloud", { deps: /^wrangler$|^@cloudflare\/.+/, paths: /(^|\/)wrangler\.(toml|jsonc?)$/, text: /\bCloudflare Workers\b|cloudflare\/wrangler-action/i }),
  T("Vercel", "cloud", { paths: /(^|\/)vercel\.json$/ }),
  T("Netlify", "cloud", { paths: /(^|\/)netlify\.toml$/ }),
  T("Heroku", "cloud", { paths: /(^|\/)heroku\.yml$/, text: /\bHeroku\b/ }),
  T("Fly.io", "cloud", { paths: /(^|\/)fly\.toml$/ }),
  T("Firebase", "cloud", { deps: /^firebase$|^firebase-admin$/, paths: /(^|\/)firebase\.json$/, text: /\bFirebase\b/ }),
  T("DigitalOcean", "cloud", { text: /\bDigitalOcean\b/ }),

  // ---------------------------------------------------------------- infrastructure & deployment
  T("Docker", "infrastructure", {
    paths: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w.-]+\.Dockerfile|docker-compose(\.[\w-]+)?\.ya?ml|compose\.ya?ml)$/,
    text: /\bDocker\b|docker\/build-push-action/,
  }),
  T("Kubernetes", "infrastructure", {
    paths: /(^|\/)(k8s|kubernetes|kustomize)\/.+\.ya?ml$|(^|\/)kustomization\.ya?ml$|(^|\/)skaffold\.ya?ml$/,
    text: /\bKubernetes\b|\bK8s\b|\bkubectl\b|\bEKS\b|\bGKE\b|\bAKS\b/,
  }),
  T("Helm", "infrastructure", { paths: /(^|\/)Chart\.ya?ml$/, text: /\bHelm\b/ }),
  T("Terraform", "infrastructure", { paths: /\.tf$|(^|\/)\.terraform\.lock\.hcl$/, text: /\bTerraform\b|hashicorp\/setup-terraform/ }),
  T("Pulumi", "infrastructure", { paths: /(^|\/)Pulumi\.ya?ml$/, deps: /^@pulumi\/.+|^pulumi$/, text: /\bPulumi\b/ }),
  T("Ansible", "infrastructure", { paths: /(^|\/)(ansible\.cfg|playbook[\w-]*\.ya?ml)$/, text: /\bAnsible\b/ }),
  T("Serverless Framework", "infrastructure", { paths: /(^|\/)serverless\.ya?ml$/, deps: /^serverless$/ }),
  T("GitHub Actions", "infrastructure", { paths: /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/, text: /\bGitHub Actions\b/ }),
  T("GitLab CI", "infrastructure", { paths: /(^|\/)\.gitlab-ci\.ya?ml$/, text: /\bGitLab CI\b/i }),
  T("CircleCI", "infrastructure", { paths: /(^|\/)\.circleci\/config\.ya?ml$/, text: /\bCircleCI\b/i }),
  T("Jenkins", "infrastructure", { paths: /(^|\/)Jenkinsfile$/, text: /\bJenkins\b/ }),
  T("Buildkite", "infrastructure", { paths: /(^|\/)\.buildkite\//, text: /\bBuildkite\b/ }),
  T("Travis CI", "infrastructure", { paths: /(^|\/)\.travis\.ya?ml$/ }),
  T("Argo CD", "infrastructure", { text: /\bArgo ?CD\b|\bArgo Workflows\b|\bArgo Rollouts\b/i }),
  T("Bazel", "infrastructure", { paths: /(^|\/)(WORKSPACE(\.bazel)?|MODULE\.bazel|BUILD\.bazel|\.bazelrc)$/, text: /\bBazel\b/ }),
  T("Gradle", "infrastructure", { paths: /(^|\/)build\.gradle(\.kts)?$/, text: /\bGradle\b/ }),
  T("Maven", "infrastructure", { paths: /(^|\/)pom\.xml$/, text: /\bMaven\b/ }),
  T("Nx", "infrastructure", { paths: /(^|\/)nx\.json$/, deps: /^nx$/ }),
  T("Turborepo", "infrastructure", { paths: /(^|\/)turbo\.json$/, deps: /^turbo$/ }),
  T("Dependabot", "infrastructure", { paths: /(^|\/)\.github\/dependabot\.ya?ml$/ }),
  T("Renovate", "infrastructure", { paths: /(^|\/)(renovate\.json5?|\.renovaterc(\.json)?)$/ }),
  T("Prometheus", "infrastructure", { deps: /^prom-client$|^prometheus[-_]client$|^github\.com\/prometheus\/client_golang(\/.*)?$/, text: /\bPrometheus\b/ }),
  T("Grafana", "infrastructure", { text: /\bGrafana\b/ }),
  T("Datadog", "infrastructure", { deps: /^dd-trace$|^ddtrace$|^datadog.*$|^gopkg\.in\/DataDog\/dd-trace-go\.v1$/, text: /\bDatadog\b/i }),
  T("OpenTelemetry", "infrastructure", { deps: /^@opentelemetry\/.+|^opentelemetry-.+|^go\.opentelemetry\.io\/otel(\/.*)?$|^io\.opentelemetry$/, text: /\bOpenTelemetry\b|\bOTel\b/ }),
  T("Sentry", "infrastructure", { deps: /^@sentry\/.+|^sentry-sdk$|^github\.com\/getsentry\/sentry-go$/, text: /\bSentry\b/ }),
  T("PostgreSQL", "infrastructure", { deps: /^pg$|^psycopg2?(-binary)?$|^psycopg$|^asyncpg$|^github\.com\/(lib\/pq|jackc\/pgx(\/v\d+)?)$|^org\.postgresql$|^postgresql$/, text: /\bPostgres(?:QL)?\b/i }),
  T("MySQL", "infrastructure", { deps: /^mysql2?$|^pymysql$|^mysqlclient$|^github\.com\/go-sql-driver\/mysql$/, text: /\bMySQL\b/ }),
  T("MongoDB", "infrastructure", { deps: /^mongodb$|^mongoose$|^pymongo$|^go\.mongodb\.org\/mongo-driver$/, text: /\bMongoDB\b/i }),
  T("Redis", "infrastructure", { deps: /^redis$|^ioredis$|^github\.com\/(go-redis|redis)\/(go-)?redis(\/v\d+)?$/, text: /\bRedis\b/ }),
  T("Elasticsearch", "infrastructure", { deps: /^@elastic\/elasticsearch$|^elasticsearch$/, text: /\bElasticsearch\b|\bOpenSearch\b/i }),
  T("Snowflake", "infrastructure", { deps: /^snowflake-connector-python$|^snowflake-sdk$/, text: /\bSnowflake\b/ }),

  // ---------------------------------------------------------------- architecture signals
  T("Microservices", "architecture", { text: /\bmicro-?services?\b/i }),
  T("Kafka (event streaming)", "architecture", {
    deps: /^kafkajs$|^confluent-kafka$|^kafka-python$|^github\.com\/(Shopify|IBM)\/sarama$|^github\.com\/segmentio\/kafka-go$|^kafka-clients$|^org\.apache\.kafka$|^rdkafka$/,
    text: /\bKafka\b/,
  }),
  T("RabbitMQ (messaging)", "architecture", { deps: /^amqplib$|^pika$|^github\.com\/rabbitmq\/amqp091-go$/, text: /\bRabbitMQ\b/ }),
  T("Event-driven architecture", "architecture", { text: /\bevent[- ]driven\b|\bevent sourcing\b/i }),
  T("Service mesh", "architecture", { text: /\bservice mesh\b|\bIstio\b|\bLinkerd\b|\bEnvoy\b/i }),
  T("Serverless architecture", "architecture", { text: /\bserverless\b|\bAWS Lambda\b|\bCloud Functions\b/i }),
  T("Monorepo", "architecture", { paths: /(^|\/)(pnpm-workspace\.yaml|lerna\.json|go\.work)$/, text: /\bmonorepo\b/i }),
  T("Distributed systems", "architecture", { text: /\bdistributed systems?\b/i }),
];

export const CATALOG_BY_NAME = new Map(CATALOG.map((t) => [t.name, t]));

/** Return a ~180 character window around a regex match, for human-readable evidence. */
export function snippetAround(text: string, index: number, length: number, radius = 80) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

export interface TextMatch {
  def: TechDef;
  snippet: string;
}

/** Match technologies mentioned in prose (job descriptions, article titles/summaries, workflows). */
export function detectInText(text: string): TextMatch[] {
  if (!text) return [];
  const out: TextMatch[] = [];
  for (const def of CATALOG) {
    if (!def.text) continue;
    const m = def.text.exec(text);
    if (m) out.push({ def, snippet: snippetAround(text, m.index, m[0].length) });
  }
  return out;
}

export interface PathMatch {
  def: TechDef;
  paths: string[];
}

/** Match technologies from repository file paths (Dockerfile, *.tf, workflows, …). */
export function detectInPaths(paths: string[]): PathMatch[] {
  const out: PathMatch[] = [];
  for (const def of CATALOG) {
    if (!def.paths) continue;
    const hits = paths.filter((p) => def.paths!.test(p));
    if (hits.length) out.push({ def, paths: hits.slice(0, 5) });
  }
  return out;
}

/** Microservices heuristic from code: container definitions in 3+ distinct service directories. */
export function detectMultiServiceLayout(paths: string[]): string[] | null {
  const dirs = new Set<string>();
  for (const p of paths) {
    if (/(^|\/)Dockerfile(\.[\w-]+)?$/.test(p)) {
      const dir = p.split("/").slice(0, -1).join("/");
      if (dir) dirs.add(dir);
    }
  }
  return dirs.size >= 3 ? [...dirs].slice(0, 6) : null;
}

export type ManifestKind =
  | "package.json"
  | "requirements.txt"
  | "pyproject.toml"
  | "go.mod"
  | "Gemfile"
  | "pom.xml"
  | "build.gradle"
  | "Cargo.toml"
  | "composer.json";

export function manifestKind(path: string): ManifestKind | null {
  const file = path.split("/").pop() ?? "";
  if (file === "package.json") return "package.json";
  if (/^requirements(-[\w]+)?\.txt$/.test(file)) return "requirements.txt";
  if (file === "pyproject.toml") return "pyproject.toml";
  if (file === "go.mod") return "go.mod";
  if (file === "Gemfile") return "Gemfile";
  if (file === "pom.xml") return "pom.xml";
  if (file === "build.gradle" || file === "build.gradle.kts") return "build.gradle";
  if (file === "Cargo.toml") return "Cargo.toml";
  if (file === "composer.json") return "composer.json";
  return null;
}

/** Parse dependency names out of a manifest. Unknown/invalid content yields []. */
export function parseDependencies(kind: ManifestKind, content: string): string[] {
  const names = new Set<string>();
  const add = (n: string | undefined) => {
    if (n) names.add(n.trim());
  };
  try {
    switch (kind) {
      case "package.json": {
        const j = JSON.parse(content) as Record<string, Record<string, string> | undefined>;
        for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
          Object.keys(j[k] ?? {}).forEach(add);
        }
        break;
      }
      case "composer.json": {
        const j = JSON.parse(content) as Record<string, Record<string, string> | undefined>;
        Object.keys({ ...(j.require ?? {}), ...(j["require-dev"] ?? {}) }).forEach(add);
        break;
      }
      case "requirements.txt":
        for (const line of content.split(/\r?\n/)) {
          const m = /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)/.exec(line);
          if (m && !line.trim().startsWith("#") && !line.trim().startsWith("-")) add(m[1].toLowerCase());
        }
        break;
      case "pyproject.toml":
        for (const m of content.matchAll(/["']([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=~!;]|["'])/g)) add(m[1].toLowerCase());
        for (const m of content.matchAll(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=\s*(?:["'^~{])/gm)) add(m[1].toLowerCase());
        break;
      case "go.mod":
        for (const m of content.matchAll(/^\s*(?:require\s+)?([a-zA-Z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v[\d.]/gm)) add(m[1]);
        break;
      case "Gemfile":
        for (const m of content.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) add(m[1]);
        break;
      case "pom.xml":
        for (const m of content.matchAll(/<(groupId|artifactId)>\s*([^<\s]+)\s*<\/\1>/g)) add(m[2]);
        break;
      case "build.gradle":
        for (const m of content.matchAll(/["']([\w.-]+):([\w.-]+)(?::[^"']*)?["']/g)) {
          add(m[1]);
          add(m[2]);
        }
        for (const m of content.matchAll(/id\s*\(?\s*["']([\w.-]+)["']/g)) add(m[1]);
        break;
      case "Cargo.toml":
        for (const m of content.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(?:["{])/gm)) add(m[1]);
        break;
    }
  } catch {
    return [];
  }
  return [...names];
}

export interface DepMatch {
  def: TechDef;
  deps: string[];
}

export function detectInDependencies(deps: string[]): DepMatch[] {
  const out: DepMatch[] = [];
  for (const def of CATALOG) {
    if (!def.deps) continue;
    const hits = deps.filter((d) => def.deps!.test(d));
    if (hits.length) out.push({ def, deps: hits.slice(0, 5) });
  }
  return out;
}

/** Engineering-ish job titles worth scanning for technology requirements. */
export const ENGINEERING_TITLE =
  /\b(engineer|engineering|developer|SRE|site reliability|devops|platform|infrastructure|architect|backend|back-end|frontend|front-end|full[- ]?stack|data scientist|machine learning|ML|security|mobile|iOS|Android|QA|test automation)\b/i;
