import { describe, expect, it } from "vitest";
import { quotaFromError } from "@/lib/ai/gemini";

const body = (quotaId: string, retryDelay: string) =>
  JSON.stringify({
    error: {
      code: 429,
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
      ],
    },
  });

describe("quotaFromError", () => {
  it("treats a per-day quota as exhausted until the retry delay", () => {
    const q = quotaFromError("gemini-3.8-flash", body("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "21355s"));
    expect(q).not.toBeNull();
    expect(q!.resetAt.getTime() - Date.now()).toBeGreaterThan(21_000_000);
  });

  it("leaves short per-minute limits to normal retry/backoff", () => {
    expect(quotaFromError("gemini-3.6-flash", body("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "20s"))).toBeNull();
    expect(quotaFromError("gemini-3.6-flash", "not json")).toBeNull();
  });
});
