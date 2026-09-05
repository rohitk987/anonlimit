import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../apps/web/src/lib/api-client.js";

const RESET_RESPONSE = {
  protocolVersion: "AnonLimit/v1",
  demoRunId: "00000000-0000-4000-8000-000000000099",
  resetAt: "2026-09-05T18:00:00.000Z",
  policy: {
    id: "anon-demo",
    version: 1,
    issuerKeyId: "demo-issuer-v1",
    audience: "demo-service",
    maxUses: 3,
    quotaWindowId: "hackathon-demo",
    status: "ACTIVE",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2036-01-01T00:00:00.000Z",
  },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser demo reset client", () => {
  it("posts the strict empty reset request and parses its strict response", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify(RESET_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createApiClient("http://localhost:4000").resetDemo()).resolves.toEqual(
      RESET_RESPONSE
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:4000/v1/demo/reset",
      expect.objectContaining({ method: "POST", body: "{}", credentials: "omit" })
    );
  });

  it("rejects a reset response containing unrecognized fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...RESET_RESPONSE, unexpected: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
      )
    );

    await expect(createApiClient("http://localhost:4000").resetDemo()).rejects.toThrow();
  });
});
