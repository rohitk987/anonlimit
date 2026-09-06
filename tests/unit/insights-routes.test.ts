import { describe, expect, it, vi } from "vitest";
import { parseApiEnv } from "@anonlimit/config/server";
import type { EvidenceController } from "../../apps/api/src/modules/evidence/evidence-controller.js";
import { createApp } from "../../apps/api/src/app.js";

function config(demoMode: boolean) {
  return parseApiEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    API_PORT: "4000",
    WEB_ORIGIN: "http://localhost:5173",
    DATABASE_URL_API: "postgresql://api:test-pass@localhost:5432/test",
    DEMO_MODE: String(demoMode),
    ACTION_SERVICE_URL: "http://localhost:4100",
    ACTION_SERVICE_TOKEN: "a".repeat(48),
    VERIFIER_LEDGER_HMAC_KEY: "b".repeat(48),
    VERIFIER_ACTION_HMAC_KEY: "c".repeat(48),
    OPAQUE_CRYPTO_PROVIDER: "simulated",
    ISSUER_KEY_ID: "test-issuer",
    ISSUER_PRIVATE_KEY_PATH: "/run/secrets/test.key",
    ISSUER_PUBLIC_PARAMETERS_PATH: "/run/secrets/test.json",
  });
}

describe("demo insight route boundary", () => {
  it("is absent outside demo mode and never calls analysis", async () => {
    const getInsights = vi.fn<EvidenceController["getInsights"]>();
    const app = createApp(config(false), async () => undefined, undefined, undefined, undefined, {
      getInsights,
      getEvidence: vi.fn(),
      runLinkability: vi.fn(),
    });
    try {
      expect((await app.inject({ method: "GET", url: "/v1/demo/insights" })).statusCode).toBe(404);
      expect(getInsights).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects client-selected runs and collapses errors without leaking provider details", async () => {
    const getInsights = vi
      .fn<EvidenceController["getInsights"]>()
      .mockRejectedValue(new Error("PRIVATE_BACKEND_CANARY"));
    const app = createApp(config(true), async () => undefined, undefined, undefined, undefined, {
      getInsights,
      getEvidence: vi.fn(),
      runLinkability: vi.fn(),
    });
    try {
      const invalid = await app.inject({
        method: "GET",
        url: "/v1/demo/insights?demoRunId=another-run",
      });
      expect(invalid.statusCode).toBe(400);
      expect(getInsights).not.toHaveBeenCalled();
      expect(
        (await app.inject({ method: "POST", url: "/v1/demo/insights", payload: {} })).statusCode
      ).toBe(404);
      const failed = await app.inject({ method: "GET", url: "/v1/demo/insights" });
      expect(failed.statusCode).toBe(500);
      expect(failed.headers["cache-control"]).toBe("no-store");
      expect(failed.body).not.toContain("PRIVATE_BACKEND_CANARY");
      expect(getInsights).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
