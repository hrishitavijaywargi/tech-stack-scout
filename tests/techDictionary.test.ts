import { describe, expect, it } from "vitest";
import { TECHS, TERRAFORM_PROVIDERS, detectInDependencies, detectInPaths, detectInText, detectMultiServiceLayout, manifestKind, parseDependencies, serverlessProvider } from "@/lib/techDictionary";

const names = (xs: { def: { name: string } }[]) => xs.map((x) => x.def.name).sort();

describe("dictionary", () => {
  it("has ~150+ unique technologies", () => {
    expect(TECHS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(TECHS.map((t) => t.name.toLowerCase())).size).toBe(TECHS.length);
  });

  it("maps aliases (golang → Go, GCP → Google Cloud, k8s → Kubernetes)", () => {
    expect(names(detectInText("We write Golang services on GCP with k8s"))).toEqual(expect.arrayContaining(["Go", "Google Cloud", "Kubernetes"]));
  });

  it("does not match Go in ordinary English or Java inside JavaScript", () => {
    expect(names(detectInText("We go to market quickly and go above and beyond"))).not.toContain("Go");
    expect(names(detectInText("Strong JavaScript skills"))).not.toContain("Java");
  });
});

describe("repository detection", () => {
  it("finds infrastructure files", () => {
    const hits = names(detectInPaths(["Dockerfile", "infra/main.tf", ".github/workflows/ci.yml", "deploy/k8s/api.yaml", "charts/api/Chart.yaml", "docker-compose.yml", "pnpm-workspace.yaml"]));
    expect(hits).toEqual(expect.arrayContaining(["Docker", "Docker Compose", "Terraform", "GitHub Actions", "Kubernetes", "Helm", "Monorepo"]));
  });

  it("detects multi-service container layouts", () => {
    expect(detectMultiServiceLayout(["services/a/Dockerfile", "services/b/Dockerfile", "services/c/Dockerfile"])).toHaveLength(3);
    expect(detectMultiServiceLayout(["Dockerfile", "web/Dockerfile"])).toBeNull();
  });

  it("parses manifests and maps dependencies", () => {
    expect(names(detectInDependencies(parseDependencies("package.json", JSON.stringify({ dependencies: { react: "^19", "@aws-sdk/client-s3": "3", kafkajs: "2" } }))))).toEqual(["AWS", "Kafka", "React"]);
    expect(names(detectInDependencies(parseDependencies("go.mod", "require (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgoogle.golang.org/grpc v1.60.0\n)\n")))).toEqual(["Gin", "gRPC"]);
    expect(names(detectInDependencies(parseDependencies("requirements.txt", "Django==4.2\nboto3>=1.28\n")))).toEqual(["AWS", "Django"]);
    expect(parseDependencies("package.json", "{ not json")).toEqual([]);
    expect(manifestKind("svc/go.mod")).toBe("go.mod");
  });

  it("reads Terraform and Serverless cloud providers", () => {
    const tf = 'terraform { required_providers { aws = { source = "hashicorp/aws" } } }\nprovider "google" {}';
    expect(TERRAFORM_PROVIDERS.filter((p) => p.re.test(tf)).map((p) => p.tech)).toEqual(["AWS", "Google Cloud"]);
    expect(serverlessProvider("service: api\nprovider:\n  name: aws\n  runtime: nodejs20.x\n")).toBe("AWS");
  });
});
