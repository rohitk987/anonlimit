import { describe, expect, it } from "vitest";
import { parseApiEnv, parseActionEnv } from "@anonlimit/config/server";
import { createApp as createApi } from "../../apps/api/src/app.js";
import { createApp as createAction } from "../../apps/action-simulator/src/app.js";
const common = { NODE_ENV: "test", LOG_LEVEL: "silent", ACTION_SERVICE_TOKEN: "a".repeat(64) };
const apiEnv = parseApiEnv({
  ...common,
  API_PORT: "4000",
  WEB_ORIGIN: "http://localhost:5173",
  DATABASE_URL_API: "postgresql://api:test-only@localhost/db",
  DEMO_MODE: "false",
  ACTION_SERVICE_URL: "http://localhost:4100",
  VERIFIER_LEDGER_HMAC_KEY: "b".repeat(64),
  VERIFIER_ACTION_HMAC_KEY: "c".repeat(64),
  OPAQUE_CRYPTO_PROVIDER: "simulated",
  ISSUER_KEY_ID: "demo-issuer-v1",
  ISSUER_PRIVATE_KEY_PATH: "/run/secrets/issuer-simulator.key",
  ISSUER_PUBLIC_PARAMETERS_PATH: "/run/secrets/issuer-public.json",
});
const actionEnv = parseActionEnv({
  ...common,
  ACTION_PORT: "4100",
  DATABASE_URL_ACTION: "postgresql://action:test-only@localhost/db",
});
describe("foundation health surfaces", () => {
  for (const [service, create] of [
    ["api", (check: () => Promise<void>) => createApi(apiEnv, check)],
    ["action-simulator", (check: () => Promise<void>) => createAction(actionEnv, check)],
  ] as const) {
    it(service + " reflects actual readiness and exposes no product success routes", async () => {
      let unavailable = false;
      const app = create(() =>
        unavailable ? Promise.reject(new Error("private-db-url-and-password")) : Promise.resolve()
      );
      try {
        const ready = await app.inject("/health/ready");
        expect(ready.statusCode).toBe(200);
        expect(ready.json()).toEqual({ status: "ok", service, phase: 1 });
        unavailable = true;
        const failed = await app.inject("/health/ready");
        expect(failed.statusCode).toBe(503);
        expect(failed.json()).toEqual({ status: "unavailable", service, phase: 1 });
        expect(failed.body).not.toContain("private");
        expect((await app.inject("/health/live")).statusCode).toBe(200);
        const missing = await app.inject({ method: "POST", url: "/v1/verifier/presentations" });
        expect(missing.statusCode).toBe(404);
        expect(missing.body).not.toContain("/v1/verifier");
      } finally {
        await app.close();
      }
    });
  }
  it("allows only the configured browser origin", async () => {
    const app = createApi(apiEnv, () => Promise.resolve());
    try {
      const own = await app.inject({
        url: "/health/ready",
        headers: { origin: "http://localhost:5173" },
      });
      expect(own.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      const other = await app.inject({
        url: "/health/ready",
        headers: { origin: "https://untrusted.example" },
      });
      expect(other.headers["access-control-allow-origin"]).not.toBe("https://untrusted.example");
    } finally {
      await app.close();
    }
  });
  it("does not register demo fault controls when demo mode is disabled", async () => {
    const app = createApi(apiEnv, () => Promise.resolve(), undefined, {
      arm: async () => {
        throw new Error("DEMO_ROUTE_MUST_BE_ABSENT");
      },
      consumeAfterDurableResult: async () => false,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/demo/faults/drop-next-ack",
        headers: { "content-type": "application/json" },
        payload: { operationId: "00000000-0000-4000-8000-000000000001" },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "NOT_FOUND" });
    } finally {
      await app.close();
    }
  });
});
