import { describe, expect, it } from "vitest";
import { parseApiEnv } from "@anonlimit/config/server";
import type { Policy } from "@anonlimit/contracts";
import { createApp } from "../../apps/api/src/app.js";
import {
  createDemoResetController,
  type DemoResetRepository,
} from "../../apps/api/src/modules/demo/reset-demo.js";
import type { ActionSimulatorResetClient } from "../../apps/api/src/modules/internal/action-simulator-client.js";

const TRACE_ID = "00000000-0000-4000-8000-000000000010";
const OLD_RUN_ID = "00000000-0000-4000-8000-000000000011";
const NEW_RUN_ID = "00000000-0000-4000-8000-000000000012";
const EVENT_ID = "00000000-0000-4000-8000-000000000013";
const POLICY: Policy = {
  id: "anon-demo",
  version: 1,
  issuerKeyId: "demo-issuer-v1",
  audience: "demo-service",
  maxUses: 3,
  quotaWindowId: "hackathon-demo",
  status: "ACTIVE",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2036-01-01T00:00:00.000Z",
};

function testController(input: {
  readonly action?: ActionSimulatorResetClient;
  readonly repository?: DemoResetRepository;
}) {
  const action = input.action ?? {
    resetDemoRun: async (demoRunId: string) => ({
      demoRunId,
      resetAt: "2026-09-05T18:00:00.000Z",
    }),
  };
  const repository = input.repository ?? {
    getActiveDemoRun: async () => ({ demoRunId: OLD_RUN_ID }),
    resetDemoRun: async () => ({
      demoRunId: NEW_RUN_ID,
      resetAt: "2026-09-05T18:00:00.000Z",
      policy: POLICY,
    }),
  };
  const ids = [NEW_RUN_ID, EVENT_ID];
  return createDemoResetController({
    repository,
    actionClient: action,
    policyId: POLICY.id,
    policyVersion: POLICY.version,
    now: () => Date.parse("2026-09-05T18:00:00.000Z"),
    randomUuid: () => {
      const value = ids.shift();
      if (!value) throw new Error("TEST_ID_EXHAUSTED");
      return value;
    },
  });
}

const apiEnv = parseApiEnv({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  API_PORT: "4000",
  WEB_ORIGIN: "http://localhost:5173",
  DATABASE_URL_API: "postgresql://api:test-only@localhost/db",
  DEMO_MODE: "true",
  ACTION_SERVICE_URL: "http://localhost:4100",
  ACTION_SERVICE_TOKEN: "a".repeat(64),
  VERIFIER_LEDGER_HMAC_KEY: "b".repeat(64),
  VERIFIER_ACTION_HMAC_KEY: "c".repeat(64),
  OPAQUE_CRYPTO_PROVIDER: "simulated",
  ISSUER_KEY_ID: "demo-issuer-v1",
  ISSUER_PRIVATE_KEY_PATH: "/run/secrets/issuer-simulator.key",
  ISSUER_PUBLIC_PARAMETERS_PATH: "/run/secrets/issuer-public.json",
});

describe("demo reset", () => {
  it("fences the action run before replacing the server-owned verifier run", async () => {
    const calls: string[] = [];
    const controller = testController({
      action: {
        resetDemoRun: async (demoRunId) => {
          calls.push(`action:${demoRunId}`);
          return { demoRunId, resetAt: "2026-09-05T18:00:00.000Z" };
        },
      },
      repository: {
        getActiveDemoRun: async () => ({ demoRunId: OLD_RUN_ID }),
        resetDemoRun: async (input) => {
          calls.push(`verifier:${input.expectedDemoRunId}`);
          expect(input.newDemoRunId).toBe(NEW_RUN_ID);
          expect(input.eventId).toBe(EVENT_ID);
          return {
            demoRunId: NEW_RUN_ID,
            resetAt: input.resetAt,
            policy: POLICY,
          };
        },
      },
    });
    await expect(controller.reset(TRACE_ID)).resolves.toEqual({
      protocolVersion: "AnonLimit/v1",
      demoRunId: NEW_RUN_ID,
      resetAt: "2026-09-05T18:00:00.000Z",
      policy: POLICY,
    });
    expect(calls).toEqual([`action:${OLD_RUN_ID}`, `verifier:${OLD_RUN_ID}`]);
  });

  it("accepts only an empty public reset request", async () => {
    const app = createApp(apiEnv, async () => undefined, undefined, undefined, testController({}));
    try {
      const valid = await app.inject({
        method: "POST",
        url: "/v1/demo/reset",
        headers: { "content-type": "application/json" },
        payload: {},
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toMatchObject({ demoRunId: NEW_RUN_ID, policy: POLICY });
      const selectedRun = await app.inject({
        method: "POST",
        url: "/v1/demo/reset",
        headers: { "content-type": "application/json" },
        payload: { demoRunId: OLD_RUN_ID },
      });
      expect(selectedRun.statusCode).toBe(400);
      expect(selectedRun.json()).toMatchObject({
        code: "BAD_REQUEST",
        usageDelta: 0,
        actionDelta: 0,
      });
    } finally {
      await app.close();
    }
  });
});
