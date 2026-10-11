/**
 * The single technology dictionary. Every technology shown anywhere in the app comes from an
 * entry here matching real public evidence — the AI never adds technologies of its own.
 *
 * Each entry can be detected four ways:
 *  - aliases / text: prose (job postings, articles, CI workflow files). Aliases are matched as
 *    whole words, case-insensitively; `text` is a hand-written regex for ambiguous names (Go, Java).
 *  - paths: file paths in a repository tree (Dockerfile, *.tf, .github/workflows/*).
 *  - deps:  a single dependency name parsed from a manifest (package.json, go.mod, …).
 * Used by: GitHub collector (paths, deps, workflows), job-posting extraction (text, with
 * per-tech posting counts), article scanning, DNS/SaaS mapping and UI grouping.
 */

export type Category =
  | "language"
  | "framework"
  | "cloud"
  | "containers"
  | "iac"
  | "cicd"
  | "observability"
  | "data"
  | "saas"
  | "architecture";

export const CATEGORY_LABELS: Record<Category, string> = {
  language: "Programming languages",
  framework: "Frameworks and libraries",
  cloud: "Cloud platforms",
  containers: "Containers & orchestration",
  iac: "Infrastructure as code",
  cicd: "CI/CD & build",
  observability: "Observability",
  data: "Data & messaging",
  saas: "SaaS & tooling",
  architecture: "Architecture signals",
};

export const CATEGORY_ORDER: Category[] = ["language", "framework", "cloud", "containers", "iac", "cicd", "observability", "data", "saas", "architecture"];

export interface TechDef {
  name: string;
  category: Category;
  aliases?: string[];
  text?: RegExp;
  paths?: RegExp;
  deps?: RegExp;
  /** Hex colour for language chips/charts (GitHub linguist colours). */
  color?: string;
}

interface Opts {
  aliases?: string[];
  text?: RegExp;
  paths?: RegExp;
  deps?: RegExp;
  color?: string;
}
const T = (name: string, category: Category, o: Opts = {}): TechDef => ({ name, category, ...o });

const OTHER_LANGS = "(?:Python|Java|Rust|Kotlin|Scala|Ruby|C\\+\\+|TypeScript|Node(?:\\.js)?|Elixir|PHP)";

export const TECHS: TechDef[] = [
  // ---------------------------------------------------------------- languages (prose; repo languages come from GitHub stats)
  T("Go", "language", {
    color: "#00ADD8",
    text: new RegExp(
      `\\bGolang\\b|\\bGo\\s*(?:\\/|,|and|or)\\s*${OTHER_LANGS}\\b|\\b${OTHER_LANGS}\\s*(?:\\/|,|and|or)\\s*Go\\b|\\bin Go\\b|\\bGo (?:services|microservices|backend|developer|engineer)`,
    ),
  }),
  T("Python", "language", { color: "#3572A5", aliases: ["python"] }),
  T("Java", "language", { color: "#b07219", text: /\bJava\b(?!\s*Script)/ }),
  T("Kotlin", "language", { color: "#A97BFF", aliases: ["kotlin"] }),
  T("Scala", "language", { color: "#c22d40", text: /\bScala\b/ }),
  T("TypeScript", "language", { color: "#3178c6", aliases: ["typescript"] }),
  T("JavaScript", "language", { color: "#f1e05a", aliases: ["javascript", "ecmascript"] }),
  T("Ruby", "language", { color: "#701516", text: /\bRuby\b/ }),
  T("Rust", "language", { color: "#dea584", text: /\bRust\b(?![- ]?(?:Belt|proof|resistant))/ }),
  T("C#", "language", { color: "#178600", text: /\bC#|\bC Sharp\b/i }),
  T("C++", "language", { color: "#f34b7d", text: /\bC\+\+/ }),
  T("C", "language", { color: "#555555", text: /\b(?:C\/C\+\+|C and C\+\+|ANSI C|C99|C11|embedded C)\b/ }),
  T("PHP", "language", { color: "#4F5D95", text: /\bPHP\b/ }),
  T("Swift", "language", { color: "#F05138", text: /\bSwift(?:UI)?\b(?=[^.]{0,80}\b(?:iOS|Xcode|Objective-C)\b)|\b(?:iOS|Objective-C)\b[^.]{0,80}\bSwift(?:UI)?\b/ }),
  T("Objective-C", "language", { color: "#438eff", aliases: ["objective-c", "objc"] }),
  T("Elixir", "language", { color: "#6e4a7e", aliases: ["elixir"] }),
  T("Erlang", "language", { color: "#B83998", aliases: ["erlang"] }),
  T("Clojure", "language", { color: "#db5855", aliases: ["clojure"] }),
  T("Haskell", "language", { color: "#5e5086", aliases: ["haskell"] }),
  T("OCaml", "language", { color: "#3be133", aliases: ["ocaml"] }),
  T("F#", "language", { color: "#b845fc", text: /\bF#/ }),
  T("Dart", "language", { color: "#00B4AB", text: /\bDart\b/ }),
  T("Lua", "language", { color: "#000080", text: /\bLua\b/ }),
  T("Perl", "language", { color: "#0298c3", text: /\bPerl\b/ }),
  T("Julia", "language", { color: "#a270ba", text: /\bJulia (?:language|programming)\b/i }),
  T("SQL", "language", { color: "#e38c00", text: /\bSQL\b/ }),
  T("Shell", "language", { color: "#89e051", aliases: ["bash", "shell scripting"] }),
  T("HCL", "language", { color: "#844FBA" }),

  // ---------------------------------------------------------------- frameworks & libraries
  T("React", "framework", { deps: /^react$/, text: /\bReact(?:\.js|JS)?\b(?!\s*Native)/ }),
  T("React Native", "framework", { deps: /^react-native$/, aliases: ["react native"] }),
  T("Next.js", "framework", { deps: /^next$/, aliases: ["next.js", "nextjs"] }),
  T("Vue", "framework", { deps: /^vue$|^nuxt$/, text: /\bVue(?:\.js)?\b|\bNuxt\b/ }),
  T("Angular", "framework", { deps: /^@angular\/core$/, text: /\bAngular\b/ }),
  T("Svelte", "framework", { deps: /^svelte$|^@sveltejs\/kit$/, text: /\bSvelte(?:Kit)?\b/ }),
  T("Node.js", "framework", { aliases: ["node.js", "nodejs"], paths: /(^|\/)\.nvmrc$/ }),
  T("Deno", "framework", { aliases: ["deno"], paths: /(^|\/)deno\.jsonc?$/ }),
  T("Bun", "framework", { paths: /(^|\/)bun\.lockb?$/ }),
  T("Express", "framework", { deps: /^express$/, aliases: ["express.js", "expressjs"] }),
  T("NestJS", "framework", { deps: /^@nestjs\/core$/, aliases: ["nestjs"] }),
  T("Django", "framework", { deps: /^django$/, aliases: ["django"] }),
  T("Flask", "framework", { deps: /^flask$/, text: /\bFlask\b/ }),
  T("FastAPI", "framework", { deps: /^fastapi$/, aliases: ["fastapi"] }),
  T("Spring Boot", "framework", { deps: /^spring-boot.*|^org\.springframework\.boot$/, text: /\bSpring Boot\b|\bSpring (?:Framework|Cloud|MVC|WebFlux)\b/ }),
  T("Ruby on Rails", "framework", { deps: /^rails$/, text: /\bRuby on Rails\b|\bRails\b(?=[^.]{0,60}\bRuby\b)|\bRuby\b[^.]{0,60}\bRails\b/ }),
  T("Laravel", "framework", { deps: /^laravel\/framework$/, aliases: ["laravel"] }),
  T(".NET", "framework", { paths: /\.(csproj|sln)$/, text: /\.NET\b|\bASP\.NET\b/ }),
  T("Gin", "framework", { deps: /^github\.com\/gin-gonic\/gin$/ }),
  T("Echo", "framework", { deps: /^github\.com\/labstack\/echo(\/v\d+)?$/ }),
  T("Fiber", "framework", { deps: /^github\.com\/gofiber\/fiber(\/v\d+)?$/ }),
  T("Tokio", "framework", { deps: /^tokio$/ }),
  T("Axum", "framework", { deps: /^axum$/ }),
  T("Actix", "framework", { deps: /^actix-web$/ }),
  T("Phoenix", "framework", { text: /\bPhoenix (?:framework|LiveView)\b/i }),
  T("GraphQL", "framework", { deps: /^graphql$|^@apollo\/server$|^apollo-server.*|^graphene$|^strawberry-graphql$|^github\.com\/99designs\/gqlgen$/, paths: /\.(graphql|gql)$/, aliases: ["graphql"] }),
  T("gRPC", "framework", { deps: /^@grpc\/grpc-js$|^grpcio$|^google\.golang\.org\/grpc$|^io\.grpc$|^grpc-.*|^tonic$/, paths: /\.proto$/, aliases: ["grpc", "protobuf", "protocol buffers"] }),
  T("Prisma", "framework", { deps: /^prisma$|^@prisma\/client$/, aliases: ["prisma"] }),
  T("Tailwind CSS", "framework", { deps: /^tailwindcss$/, aliases: ["tailwind", "tailwindcss"] }),
  T("PyTorch", "framework", { deps: /^torch$/, aliases: ["pytorch"] }),
  T("TensorFlow", "framework", { deps: /^tensorflow$/, aliases: ["tensorflow"] }),
  T("Pandas", "framework", { deps: /^pandas$/, text: /\bpandas\b/ }),
  T("LangChain", "framework", { deps: /^langchain.*|^@langchain\/.+/, aliases: ["langchain"] }),
  T("Flutter", "framework", { paths: /(^|\/)pubspec\.yaml$/, aliases: ["flutter"] }),
  T("Electron", "framework", { deps: /^electron$/, text: /\bElectron\b/ }),
  T("Celery", "framework", { deps: /^celery$/, aliases: ["celery"] }),
  T("Sidekiq", "framework", { deps: /^sidekiq$/, aliases: ["sidekiq"] }),

  // ---------------------------------------------------------------- cloud & hosting
  T("AWS", "cloud", {
    deps: /^aws-sdk$|^@aws-sdk\/.+|^boto3$|^botocore$|^aws-cdk-lib$|^@aws-cdk\/.+|^github\.com\/aws\/aws-sdk-go(-v2)?(\/.*)?$|^software\.amazon\.awssdk$/,
    paths: /(^|\/)(cdk\.json|samconfig\.toml|buildspec\.ya?ml|appspec\.ya?ml)$|(^|\/)\.ebextensions\//,
    text: /\bAWS\b|\bAmazon Web Services\b|\bEKS\b|\bECS\b|\bCloudFormation\b|\bLambda\b(?= functions?)|aws-actions\//,
  }),
  T("Google Cloud", "cloud", {
    deps: /^@google-cloud\/.+|^google-cloud-.+|^cloud\.google\.com\/go(\/.*)?$|^com\.google\.cloud$/,
    paths: /(^|\/)cloudbuild\.ya?ml$/,
    text: /\bGoogle Cloud\b|\bGCP\b|\bGKE\b|\bBigQuery\b|\bCloud Run\b|google-github-actions\//,
  }),
  T("Microsoft Azure", "cloud", { deps: /^@azure\/.+|^azure-.+|^com\.azure$|^github\.com\/Azure\/azure-sdk-for-go(\/.*)?$/, paths: /(^|\/)azure-pipelines\.ya?ml$/, text: /\bAzure\b|\bAKS\b|azure\/login/ }),
  T("Cloudflare", "cloud", { deps: /^wrangler$|^@cloudflare\/.+/, paths: /(^|\/)wrangler\.(toml|jsonc?)$/, text: /\bCloudflare(?: Workers| R2| D1)?\b|cloudflare\/wrangler-action/ }),
  T("Vercel", "cloud", { paths: /(^|\/)vercel\.json$/, text: /\bVercel\b/ }),
  T("Netlify", "cloud", { paths: /(^|\/)netlify\.toml$/, text: /\bNetlify\b/ }),
  T("Heroku", "cloud", { paths: /(^|\/)heroku\.yml$/, text: /\bHeroku\b/ }),
  T("Fly.io", "cloud", { paths: /(^|\/)fly\.toml$/, aliases: ["fly.io"] }),
  T("Firebase", "cloud", { deps: /^firebase$|^firebase-admin$/, paths: /(^|\/)firebase\.json$/, aliases: ["firebase"] }),
  T("DigitalOcean", "cloud", { aliases: ["digitalocean"] }),
  T("Oracle Cloud", "cloud", { aliases: ["oracle cloud", "oracle cloud infrastructure"] }),
  T("Alibaba Cloud", "cloud", { aliases: ["alibaba cloud", "aliyun"] }),
  T("Fastly", "cloud", { aliases: ["fastly"] }),
  T("Akamai", "cloud", { aliases: ["akamai"] }),
  T("Supabase", "cloud", { deps: /^@supabase\/supabase-js$|^supabase$/, paths: /(^|\/)supabase\/config\.toml$/, aliases: ["supabase"] }),

  // ---------------------------------------------------------------- containers & orchestration
  T("Docker", "containers", { paths: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w.-]+\.Dockerfile)$/, text: /\bDocker\b|docker\/build-push-action/ }),
  T("Docker Compose", "containers", { paths: /(^|\/)(docker-compose(\.[\w-]+)?\.ya?ml|compose\.ya?ml)$/, aliases: ["docker compose", "docker-compose"] }),
  T("Kubernetes", "containers", { paths: /(^|\/)(k8s|kubernetes|kustomize)\/.+\.ya?ml$|(^|\/)kustomization\.ya?ml$|(^|\/)skaffold\.ya?ml$/, text: /\bKubernetes\b|\b[Kk]8s\b|\bkubectl\b|\bEKS\b|\bGKE\b|\bAKS\b/ }),
  T("Helm", "containers", { paths: /(^|\/)Chart\.ya?ml$|(^|\/)helm\//, text: /\bHelm\b/ }),
  T("Nomad", "containers", { paths: /\.nomad(\.hcl)?$/, text: /\bNomad\b/ }),
  T("Istio", "containers", { aliases: ["istio"] }),
  T("Linkerd", "containers", { aliases: ["linkerd"] }),
  T("Envoy", "containers", { aliases: ["envoy proxy", "envoy"] }),
  T("Argo CD", "containers", { text: /\bArgo ?CD\b|\bArgo Workflows\b|\bArgo Rollouts\b/i }),
  T("Flux", "containers", { text: /\bFlux ?CD\b/i }),
  T("ECS", "containers", { text: /\bAmazon ECS\b|\bECS Fargate\b|\bFargate\b/ }),
  T("Serverless Framework", "containers", { paths: /(^|\/)serverless\.ya?ml$/, deps: /^serverless$/ }),

  // ---------------------------------------------------------------- infrastructure as code
  T("Terraform", "iac", { paths: /\.tf$|(^|\/)\.terraform\.lock\.hcl$/, text: /\bTerraform\b|hashicorp\/setup-terraform/ }),
  T("Pulumi", "iac", { paths: /(^|\/)Pulumi\.ya?ml$/, deps: /^@pulumi\/.+|^pulumi$/, aliases: ["pulumi"] }),
  T("AWS CDK", "iac", { deps: /^aws-cdk-lib$|^@aws-cdk\/.+/, aliases: ["aws cdk"] }),
  T("CloudFormation", "iac", { paths: /(^|\/)(template|cloudformation)[\w-]*\.ya?ml$/, aliases: ["cloudformation"] }),
  T("Ansible", "iac", { paths: /(^|\/)(ansible\.cfg|playbook[\w-]*\.ya?ml)$/, aliases: ["ansible"] }),
  T("Chef", "iac", { text: /\bChef\b(?= (?:cookbooks?|infra|recipes?))/ }),
  T("Puppet", "iac", { text: /\bPuppet\b/ }),
  T("Crossplane", "iac", { aliases: ["crossplane"] }),

  // ---------------------------------------------------------------- CI/CD & build
  T("GitHub Actions", "cicd", { paths: /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/, aliases: ["github actions"] }),
  T("GitLab CI", "cicd", { paths: /(^|\/)\.gitlab-ci\.ya?ml$/, aliases: ["gitlab ci", "gitlab-ci"] }),
  T("CircleCI", "cicd", { paths: /(^|\/)\.circleci\/config\.ya?ml$/, aliases: ["circleci"] }),
  T("Jenkins", "cicd", { paths: /(^|\/)Jenkinsfile$/, text: /\bJenkins\b/ }),
  T("Buildkite", "cicd", { paths: /(^|\/)\.buildkite\//, aliases: ["buildkite"] }),
  T("Travis CI", "cicd", { paths: /(^|\/)\.travis\.ya?ml$/, aliases: ["travis ci"] }),
  T("Spinnaker", "cicd", { aliases: ["spinnaker"] }),
  T("Bazel", "cicd", { paths: /(^|\/)(WORKSPACE(\.bazel)?|MODULE\.bazel|BUILD\.bazel|\.bazelrc)$/, aliases: ["bazel"] }),
  T("Gradle", "cicd", { paths: /(^|\/)build\.gradle(\.kts)?$/, aliases: ["gradle"] }),
  T("Maven", "cicd", { paths: /(^|\/)pom\.xml$/, text: /\bMaven\b/ }),
  T("Nx", "cicd", { paths: /(^|\/)nx\.json$/, deps: /^nx$/ }),
  T("Turborepo", "cicd", { paths: /(^|\/)turbo\.json$/, deps: /^turbo$/, aliases: ["turborepo"] }),
  T("Dependabot", "cicd", { paths: /(^|\/)\.github\/dependabot\.ya?ml$/ }),
  T("Renovate", "cicd", { paths: /(^|\/)(renovate\.json5?|\.renovaterc(\.json)?)$/ }),
  T("pre-commit", "cicd", { paths: /(^|\/)\.pre-commit-config\.ya?ml$/ }),

  // ---------------------------------------------------------------- observability
  T("Prometheus", "observability", { deps: /^prom-client$|^prometheus[-_]client$|^github\.com\/prometheus\/client_golang(\/.*)?$/, aliases: ["prometheus"] }),
  T("Grafana", "observability", { aliases: ["grafana"] }),
  T("Datadog", "observability", { deps: /^dd-trace$|^ddtrace$|^datadog.*$|^gopkg\.in\/DataDog\/dd-trace-go\.v1$/, aliases: ["datadog"] }),
  T("OpenTelemetry", "observability", { deps: /^@opentelemetry\/.+|^opentelemetry-.+|^go\.opentelemetry\.io\/otel(\/.*)?$|^io\.opentelemetry$/, aliases: ["opentelemetry", "otel"] }),
  T("Sentry", "observability", { deps: /^@sentry\/.+|^sentry-sdk$|^github\.com\/getsentry\/sentry-go$/, text: /\bSentry\b/ }),
  T("New Relic", "observability", { deps: /^newrelic$/, aliases: ["new relic", "newrelic"] }),
  T("Honeycomb", "observability", { aliases: ["honeycomb"] }),
  T("Splunk", "observability", { aliases: ["splunk"] }),
  T("Elastic Stack", "observability", { aliases: ["elk stack", "kibana", "logstash"] }),
  T("Jaeger", "observability", { aliases: ["jaeger"] }),
  T("PagerDuty", "observability", { aliases: ["pagerduty"] }),

  // ---------------------------------------------------------------- data & messaging
  T("PostgreSQL", "data", { deps: /^pg$|^psycopg2?(-binary)?$|^psycopg$|^asyncpg$|^github\.com\/(lib\/pq|jackc\/pgx(\/v\d+)?)$|^org\.postgresql$|^postgresql$/, aliases: ["postgres", "postgresql"] }),
  T("MySQL", "data", { deps: /^mysql2?$|^pymysql$|^mysqlclient$|^github\.com\/go-sql-driver\/mysql$/, aliases: ["mysql"] }),
  T("MongoDB", "data", { deps: /^mongodb$|^mongoose$|^pymongo$|^go\.mongodb\.org\/mongo-driver$/, aliases: ["mongodb"] }),
  T("Redis", "data", { deps: /^redis$|^ioredis$|^github\.com\/(go-redis|redis)\/(go-)?redis(\/v\d+)?$/, text: /\bRedis\b/ }),
  T("Elasticsearch", "data", { deps: /^@elastic\/elasticsearch$|^elasticsearch$/, aliases: ["elasticsearch", "opensearch"] }),
  T("Cassandra", "data", { aliases: ["cassandra", "scylladb"] }),
  T("DynamoDB", "data", { aliases: ["dynamodb"] }),
  T("SQLite", "data", { deps: /^sqlite3$|^better-sqlite3$/, aliases: ["sqlite"] }),
  T("ClickHouse", "data", { aliases: ["clickhouse"] }),
  T("Snowflake", "data", { deps: /^snowflake-connector-python$|^snowflake-sdk$/, text: /\bSnowflake\b/ }),
  T("BigQuery", "data", { aliases: ["bigquery"] }),
  T("Databricks", "data", { aliases: ["databricks"] }),
  T("Apache Spark", "data", { deps: /^pyspark$|^spark-core.*$/, text: /\bApache Spark\b|\bPySpark\b|\bSpark\b(?=[^.]{0,40}\b(?:Scala|streaming|cluster|SQL)\b)/ }),
  T("Apache Flink", "data", { aliases: ["flink"] }),
  T("Airflow", "data", { deps: /^apache-airflow$/, aliases: ["airflow"] }),
  T("dbt", "data", { paths: /(^|\/)dbt_project\.ya?ml$/, text: /\bdbt\b/ }),
  T("Kafka", "data", {
    deps: /^kafkajs$|^confluent-kafka$|^kafka-python$|^github\.com\/(Shopify|IBM)\/sarama$|^github\.com\/segmentio\/kafka-go$|^kafka-clients$|^org\.apache\.kafka$|^rdkafka$/,
    text: /\bKafka\b/,
  }),
  T("RabbitMQ", "data", { deps: /^amqplib$|^pika$|^github\.com\/rabbitmq\/amqp091-go$/, aliases: ["rabbitmq"] }),
  T("NATS", "data", { deps: /^nats$|^github\.com\/nats-io\/nats\.go$/, text: /\bNATS\b/ }),
  T("Amazon SQS", "data", { aliases: ["sqs"] }),
  T("Pub/Sub", "data", { text: /\bPub\/Sub\b/ }),
  T("Temporal", "data", { deps: /^@temporalio\/.+|^temporalio$|^go\.temporal\.io\/sdk$/, text: /\bTemporal\b(?= (?:workflows?|\.io|server))/ }),

  // ---------------------------------------------------------------- SaaS & tooling (mostly from DNS verification records)
  T("Google Workspace", "saas", { aliases: ["google workspace", "g suite"] }),
  T("Microsoft 365", "saas", { aliases: ["microsoft 365", "office 365"] }),
  T("Atlassian", "saas", { aliases: ["atlassian", "jira", "confluence"] }),
  T("Slack", "saas", { text: /\bSlack\b/ }),
  T("Zoom", "saas", {}),
  T("GitHub", "saas", {}),
  T("GitLab", "saas", {}),
  T("Okta", "saas", { aliases: ["okta"] }),
  T("Salesforce", "saas", { aliases: ["salesforce"] }),
  T("HubSpot", "saas", { aliases: ["hubspot"] }),
  T("Stripe", "saas", {}),
  T("Twilio", "saas", {}),
  T("SendGrid", "saas", {}),
  T("Mailgun", "saas", {}),
  T("Amazon SES", "saas", {}),
  T("Postmark", "saas", {}),
  T("Mailchimp", "saas", {}),
  T("Zendesk", "saas", {}),
  T("Intercom", "saas", {}),
  T("Notion", "saas", {}),
  T("Figma", "saas", {}),
  T("DocuSign", "saas", {}),
  T("Apple Business", "saas", {}),
  T("Meta Business", "saas", {}),
  T("Adobe", "saas", {}),
  T("Docker Hub", "saas", {}),
  T("Statuspage", "saas", {}),
  T("LaunchDarkly", "saas", { deps: /^launchdarkly.*|^@launchdarkly\/.+/, aliases: ["launchdarkly"] }),
  T("Snyk", "saas", { aliases: ["snyk"] }),
  T("SonarQube", "saas", { aliases: ["sonarqube", "sonarcloud"] }),
  T("HashiCorp Vault", "saas", { text: /\bVault\b(?= (?:secrets?|by HashiCorp))|\bHashiCorp Vault\b/ }),
  T("Consul", "saas", { text: /\bConsul\b/ }),

  // ---------------------------------------------------------------- architecture signals
  T("Microservices", "architecture", { text: /\bmicro-?services?\b/i }),
  T("Event-driven architecture", "architecture", { text: /\bevent[- ]driven\b|\bevent sourcing\b/i }),
  T("Serverless architecture", "architecture", { text: /\bserverless\b|\bAWS Lambda\b|\bCloud Functions\b/i }),
  T("Monorepo", "architecture", { paths: /(^|\/)(pnpm-workspace\.yaml|lerna\.json|go\.work)$/, aliases: ["monorepo"] }),
  T("Distributed systems", "architecture", { text: /\bdistributed systems?\b/i }),
  T("Platform engineering", "architecture", { text: /\bplatform engineering\b|\binternal developer platform\b|\bdeveloper platform\b/i }),
  T("Multi-cloud", "architecture", { text: /\bmulti-?cloud\b/i }),
];

export const TECH_BY_NAME = new Map(TECHS.map((t) => [t.name.toLowerCase(), t]));
export const techByName = (name: string) => TECH_BY_NAME.get(name.toLowerCase());

/** Compiled prose matcher for each entry (explicit regex, else whole-word aliases). */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TEXT_MATCHERS: { def: TechDef; re: RegExp }[] = TECHS.flatMap((def) => {
  if (def.text) return [{ def, re: def.text }];
  if (def.aliases?.length) return [{ def, re: new RegExp(`(?<![\\w.])(?:${def.aliases.map(escape).join("|")})(?![\\w])`, "i") }];
  return [];
});

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

/** Technologies mentioned in prose (job descriptions, article titles/summaries, workflows). */
export function detectInText(text: string): TextMatch[] {
  if (!text) return [];
  const out: TextMatch[] = [];
  for (const { def, re } of TEXT_MATCHERS) {
    const m = re.exec(text);
    if (m) out.push({ def, snippet: snippetAround(text, m.index, m[0].length) });
  }
  return out;
}

export interface PathMatch {
  def: TechDef;
  paths: string[];
}

export function detectInPaths(paths: string[]): PathMatch[] {
  const out: PathMatch[] = [];
  for (const def of TECHS) {
    if (!def.paths) continue;
    const hits = paths.filter((p) => def.paths!.test(p));
    if (hits.length) out.push({ def, paths: hits.slice(0, 5) });
  }
  return out;
}

/** Container definitions in 3+ distinct directories of one repo. */
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

export type ManifestKind = "package.json" | "requirements.txt" | "pyproject.toml" | "go.mod" | "Gemfile" | "pom.xml" | "build.gradle" | "Cargo.toml" | "composer.json";

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
        for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) Object.keys(j[k] ?? {}).forEach(add);
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
  for (const def of TECHS) {
    if (!def.deps) continue;
    const hits = deps.filter((d) => def.deps!.test(d));
    if (hits.length) out.push({ def, deps: hits.slice(0, 5) });
  }
  return out;
}

/** Cloud providers declared in Terraform files. */
export const TERRAFORM_PROVIDERS: { re: RegExp; tech: string }[] = [
  { re: /provider\s+"aws"|source\s*=\s*"hashicorp\/aws"/, tech: "AWS" },
  { re: /provider\s+"google(?:-beta)?"|source\s*=\s*"hashicorp\/google/, tech: "Google Cloud" },
  { re: /provider\s+"azurerm"|source\s*=\s*"hashicorp\/azurerm"/, tech: "Microsoft Azure" },
  { re: /provider\s+"cloudflare"|source\s*=\s*"cloudflare\/cloudflare"/, tech: "Cloudflare" },
  { re: /provider\s+"kubernetes"|source\s*=\s*"hashicorp\/kubernetes"/, tech: "Kubernetes" },
  { re: /provider\s+"datadog"|source\s*=\s*"DataDog\/datadog"/, tech: "Datadog" },
];

/** Cloud from a serverless.yml `provider.name`. */
export function serverlessProvider(yaml: string): string | null {
  const m = /provider:\s*\n(?:\s+.*\n)*?\s+name:\s*['"]?(aws|google|azure|cloudflare)/i.exec(yaml) ?? /provider:\s*['"]?(aws|google|azure)\b/i.exec(yaml);
  if (!m) return null;
  return { aws: "AWS", google: "Google Cloud", azure: "Microsoft Azure", cloudflare: "Cloudflare" }[m[1].toLowerCase()] ?? null;
}

/** Engineering-ish job titles/departments worth scanning for technology requirements. */
export const ENGINEERING_TITLE =
  /\b(engineer|engineering|developer|SRE|site reliability|devops|platform|infrastructure|architect|backend|back-end|frontend|front-end|full[- ]?stack|data|machine learning|ML|AI|security|mobile|iOS|Android|QA|test automation)\b/i;
