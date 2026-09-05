import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "@anonlimit/config/server";
import { createSimulatedBoundaryProbeAdapter } from "@anonlimit/crypto/audit";
import { createApp } from "../../apps/api/src/app.js";
import {
  createDemoBoundaryController,
  type DemoBoundaryController,
} from "../../apps/api/src/modules/demo/boundary-controller.js";
import { ProtocolPublicError } from "../../apps/api/src/modules/protocol/protocol-service.js";
import type { EventStreamController } from "../../apps/api/src/modules/events/events-controller.js";
import {
  PHASE3_ACTION_KEY,
  PHASE3_ISSUER_SECRET,
  PHASE3_LEDGER_KEY,
  PHASE3_POLICY,
} from "../helpers/phase3-protocol.js";

const RUN_ID = "00000000-0000-4000-8000-000000000011";
const TRACE_ID = "00000000-0000-4000-8000-000000000012";
const config: ApiEnv = {
  nodeEnv: "test",
  logLevel: "silent",
  port: 4000,
  webOrigin: "http://localhost:5173",
  databaseUrl: "postgresql://api:test-only@localhost/db",
  demoMode: true,
  actionServiceUrl: "http://localhost:4100",
  actionServiceToken: "44".repeat(32),
  verifierLedgerHmacKey: PHASE3_LEDGER_KEY,
  verifierActionHmacKey: PHASE3_ACTION_KEY,
  opaqueCryptoProvider: "simulated",
  issuerKeyId: PHASE3_POLICY.issuerKeyId,
  issuerPrivateKeyPath: "/test/issuer.key",
  issuerPublicParametersPath: "/test/issuer-public.json",
};

describe("demo boundary probe HTTP control", () => {
  it("accepts only empty JSON and exposes the real verifier rejection", async () => {
    const attemptFourthUse = vi.fn<DemoBoundaryController["attemptFourthUse"]>(async () => {
      throw new ProtocolPublicError("PRESENTATION_REJECTED");
    });
    const app = createApp(
      config,
      async () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        attemptFourthUse,
      }
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/demo/attempt-fourth-use",
        payload: {},
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: "PRESENTATION_REJECTED",
        usageDelta: 0,
        actionDelta: 0,
      });
      expect(attemptFourthUse).toHaveBeenCalledOnce();
      for (const payload of [{ demoRunId: RUN_ID }, { hiddenSlot: 3 }, { credential: "private" }]) {
        const invalid = await app.inject({
          method: "POST",
          url: "/v1/demo/attempt-fourth-use",
          payload,
        });
        expect(invalid.statusCode).toBe(400);
      }
      const text = await app.inject({
        method: "POST",
        url: "/v1/demo/attempt-fourth-use",
        headers: { "content-type": "text/plain" },
        payload: "{}",
      });
      expect(text.statusCode).toBe(400);
      expect(attemptFourthUse).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("does not register the route or initialize a probe when demo mode is disabled", async () => {
    const attemptFourthUse = vi.fn<DemoBoundaryController["attemptFourthUse"]>();
    const app = createApp(
      { ...config, demoMode: false },
      async () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { attemptFourthUse }
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/demo/attempt-fourth-use",
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      expect(attemptFourthUse).not.toHaveBeenCalled();
      expect(() =>
        createSimulatedBoundaryProbeAdapter({
          issuerKeyId: PHASE3_POLICY.issuerKeyId,
          issuerSecret: PHASE3_ISSUER_SECRET,
          demoMode: false,
        })
      ).toThrow("DEMO_DISABLED");
    } finally {
      await app.close();
    }
  });

  it("reports a broken probe as unavailable instead of claiming verification rejected it", async () => {
    const present = vi.fn(async () => {
      throw new Error("MUST_NOT_SUBMIT");
    });
    const controller = createDemoBoundaryController({
      repository: { getActiveDemoRun: async () => ({ demoRunId: RUN_ID }) },
      protocol: {
        getPolicy: async () => ({ statusCode: 200, body: PHASE3_POLICY }),
        createChallenge: async () => ({
          statusCode: 201,
          body: {
            challengeId: RUN_ID,
            nonce: "1".repeat(64),
            policyDigest: `sha256:${"2".repeat(64)}`,
            expiresAt: "2036-01-01T00:00:00.000Z",
          },
        }),
        present,
      },
      probeAdapter: {
        createOutOfRangePresentation: async () => {
          throw new Error("PRESENTATION_REJECTED");
        },
      },
      policyId: PHASE3_POLICY.id,
      policyVersion: PHASE3_POLICY.version,
    });
    await expect(controller.attemptFourthUse(TRACE_ID)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(present).not.toHaveBeenCalled();
  });
});

describe("demo event stream resume", () => {
  it("resumes from Last-Event-ID on reconnect even when the original URL includes after=0", async () => {
    const read = vi.fn<EventStreamController["read"]>(async () => []);
    const app = createApp(
      config,
      async () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { read, format: () => "" }
    );
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/demo/events/stream?after=0",
        headers: { "last-event-id": "27" },
      });
      expect(response.statusCode).toBe(200);
      expect(read).toHaveBeenCalledWith(27);
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid resume cursors instead of replaying a different event range", async () => {
    const read = vi.fn<EventStreamController["read"]>(async () => []);
    const app = createApp(
      config,
      async () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { read, format: () => "" }
    );
    try {
      for (const cursor of ["-1", "1e2", "9007199254740992", "abc"]) {
        const response = await app.inject({
          method: "GET",
          url: "/v1/demo/events/stream?after=0",
          headers: { "last-event-id": cursor },
        });
        expect(response.statusCode).toBe(400);
      }
      expect(read).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
