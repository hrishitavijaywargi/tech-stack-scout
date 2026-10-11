import { describe, expect, it } from "vitest";
import { detectInDependencies, detectInPaths, detectInText, detectMultiServiceLayout, manifestKind, parseDependencies } from "@/lib/research/catalog";

const names = (xs: { def: { name: string } }[]) => xs.map((x) => x.def.name).sort();

describe("detectInPaths", () => {
  it("finds infrastructure files", () => {
    const hits = names(
      detectInPaths(["Dockerfile", "infra/main.tf", ".github/workflows/ci.yml", "deploy/k8s/api.yaml", "charts/api/Chart.yaml", "pnpm-workspace.yaml", "README.md"]),
    );
    expect(hits).toEqual(expect.arrayContaining(["Docker", "Terraform", "GitHub Actions", "Kubernetes", "Helm", "Monorepo"]));
    expect(hits).not.toContain("AWS");
  });

  it("detects multi-service container layouts", () => {
    expect(detectMultiServiceLayout(["services/a/Dockerfile", "services/b/Dockerfile", "services/c/Dockerfile"])).toHaveLength(3);
    expect(detectMultiServiceLayout(["Dockerfile", "web/Dockerfile"])).toBeNull();
  });
});

describe("manifests", () => {
  it("parses package.json dependencies", () => {
    const deps = parseDependencies("package.json", JSON.stringify({ dependencies: { react: "^19", "@aws-sdk/client-s3": "3" }, devDependencies: { next: "15" } }));
    expect(names(detectInDependencies(deps))).toEqual(["AWS", "Next.js", "React"]);
  });

  it("parses go.mod, requirements.txt and pom.xml", () => {
    const go = parseDependencies("go.mod", "module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgoogle.golang.org/grpc v1.60.0\n)\n");
    expect(names(detectInDependencies(go))).toEqual(["Gin", "gRPC"]);
    const py = parseDependencies("requirements.txt", "# comment\nDjango==4.2\nboto3>=1.28\n-r other.txt\n");
    expect(names(detectInDependencies(py))).toEqual(["AWS", "Django"]);
    const pom = parseDependencies("pom.xml", "<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>");
    expect(names(detectInDependencies(pom))).toContain("Spring Boot");
  });

  it("returns [] for invalid JSON instead of throwing", () => {
    expect(parseDependencies("package.json", "{ not json")).toEqual([]);
  });

  it("recognises manifest file names", () => {
    expect(manifestKind("services/api/go.mod")).toBe("go.mod");
    expect(manifestKind("requirements-dev.txt")).toBe("requirements.txt");
    expect(manifestKind("README.md")).toBeNull();
  });
});

describe("detectInText", () => {
  it("matches Go only in language context", () => {
    expect(names(detectInText("Experience with Python, Go and Kubernetes"))).toEqual(expect.arrayContaining(["Go", "Python", "Kubernetes"]));
    expect(names(detectInText("We go to market quickly and go above and beyond"))).not.toContain("Go");
  });

  it("does not confuse Java and JavaScript", () => {
    expect(names(detectInText("Strong JavaScript skills"))).not.toContain("Java");
    expect(names(detectInText("Java services on AWS"))).toEqual(expect.arrayContaining(["Java", "AWS"]));
  });

  it("returns a snippet around the match", () => {
    const [m] = detectInText("Our platform team runs Terraform for all environments.");
    expect(m.def.name).toBe("Terraform");
    expect(m.snippet).toContain("Terraform");
  });
});
