import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseActionEnv, type ApiEnv } from "@anonlimit/config/server";
import {
  challengeResponseSchema,
  demoFaultResponseSchema,
  demoResetResponseSchema,
  issuanceResponseSchema,
  policySchema,
  publicErrorSchema,
  useResultSchema,
  useStatusResponseSchema,
  type ChallengeResponse,
  type IssuanceResponse,
  type Presentation,
} from "@anonlimit/contracts";
import { createSimulatedBoundTestAdapter } from "@anonlimit/crypto/audit";
import { createSimulatedHolder } from "@anonlimit/crypto/holder";
import { createSimulatedIssuer } from "@anonlimit/crypto/issuer";
import {
  createLookupProtection,
  createSimulatedVerifier,
  sha256Hex,
} from "@anonlimit/crypto/verifier";
import { createActionDatabase } from "@anonlimit/db/action";
import { DEFAULT_POLICY_ID, DEFAULT_POLICY_VERSION, seedDefaultPolicy } from "@anonlimit/db/seed";
import {
  createVerifierDatabase,
  createWorkerDatabase,
  type VerifierDatabase,
} from "@anonlimit/db/verifier";
import { createApp as createActionApp } from "../../apps/action-simulator/src/app.js";
import { createApp as createApiApp } from "../../apps/api/src/app.js";
import { createDemoResetController } from "../../apps/api/src/modules/demo/reset-demo.js";
import { createLostAckFaultController } from "../../apps/api/src/modules/demo/fault-controller.js";
import { createActionSimulatorResetClient } from "../../apps/api/src/modules/internal/action-simulator-client.js";
import { createProtocolService } from "../../apps/api/src/modules/protocol/protocol-service.js";
import { deliverAction } from "../../apps/worker/src/action-client.js";
import {
  runGoldenScenario,
  type GoldenBackendSnapshot,
  type GoldenCompletedUse,
  type GoldenPolicyReference,
  type GoldenPreparedPresentation,
  type GoldenRejection,
  type GoldenResetResult,
  type GoldenRetryResult,
  type GoldenScenarioDriver,
} from "../../packages/testing/src/index.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";
import {
  PHASE3_ACTION,
  PHASE3_ACTION_KEY,
  PHASE3_ISSUER_SECRET,
  PHASE3_LEDGER_KEY,
  PHASE3_POLICY,
} from "../helpers/phase3-protocol.js";

const TOKEN = "phase6-action-token-" + "x".repeat(48);
const SENTINEL_RUN_ID = "f0000000-0000-4000-8000-000000000001";
const SENTINEL_USE_ID = "f0000000-0000-4000-8000-000000000002";
const SENTINEL_RECEIPT_ID = "f0000000-0000-4000-8000-000000000003";
const SENTINEL_ACTION_KEY = `hmac-sha256:${"a".repeat(64)}`;
const SENTINEL_PAYLOAD_DIGEST = `sha256:${"b".repeat(64)}`;

interface ScenarioPresentation {
  readonly presentation: Presentation;
  readonly serialized: string;
}

function apiConfig(databaseUrl: string, demoMode = true): ApiEnv {
  return {
    nodeEnv: "test",
    logLevel: "silent",
    port: 4000,
    webOrigin: "http://localhost:5173",
    databaseUrl,
    demoMode,
    actionServiceUrl: "http://127.0.0.1:4100",
    actionServiceToken: TOKEN,
    verifierLedgerHmacKey: PHASE3_LEDGER_KEY,
    verifierActionHmacKey: PHASE3_ACTION_KEY,
    opaqueCryptoProvider: "simulated",
    issuerKeyId: PHASE3_POLICY.issuerKeyId,
    issuerPrivateKeyPath: "/phase6-test/issuer.key",
    issuerPublicParametersPath: "/phase6-test/issuer-public.json",
  };
}

function deterministicBytes(seed: number): (length: number) => Uint8Array {
  let state = seed >>> 0;
  return (length) => {
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      output[index] = state & 0xff;
    }
    return output;
  };
}

function deterministicUuids(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `60000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  };
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

describe.sequential("Phase 6 reusable headless golden scenario", () => {
  let database: Phase3Postgres | undefined;
  let repository: VerifierDatabase | undefined;
  let workerDatabase: ReturnType<typeof createWorkerDatabase> | undefined;
  let actionDatabase: ReturnType<typeof createActionDatabase> | undefined;
  let actionApp: ReturnType<typeof createActionApp> | undefined;
  let apiApp: ReturnType<typeof createApiApp> | undefined;
  let actionUrl = "";
  let apiUrl = "";
  let now = 0;
  let driver: GoldenScenarioDriver<IssuanceResponse, ScenarioPresentation> | undefined;

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    const databaseClock = await database.pool.query<{ current_time: Date | string }>(
      "SELECT clock_timestamp() AS current_time"
    );
    const currentTime = databaseClock.rows[0]?.current_time;
    if (!currentTime) throw new Error("TEST_DATABASE_INCONSISTENT");
    now = new Date(currentTime).getTime();
    await seedDefaultPolicy(database.ownerConnectionString, {
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      now: () => now,
    });

    await database.pool.query(
      `INSERT INTO verifier.demo_runs
         (demo_run_id, status, started_at, closed_at)
       VALUES ($1, 'CLOSED', clock_timestamp() - interval '2 seconds',
               clock_timestamp() - interval '1 second')`,
      [SENTINEL_RUN_ID]
    );
    await database.pool.query(
      `INSERT INTO action_sim.action_results
         (action_key, demo_run_id, payload_digest, receipt, committed_at)
       VALUES ($1, $2, $3, $4::jsonb, clock_timestamp() - interval '1 second')`,
      [
        SENTINEL_ACTION_KEY,
        SENTINEL_RUN_ID,
        SENTINEL_PAYLOAD_DIGEST,
        JSON.stringify({
          receiptId: SENTINEL_RECEIPT_ID,
          useId: SENTINEL_USE_ID,
          actionKey: SENTINEL_ACTION_KEY,
          status: "COMMITTED",
          committedAt: new Date(now - 1_000).toISOString(),
        }),
      ]
    );

    actionDatabase = createActionDatabase(database.connectionStringFor("action_service"));
    actionApp = createActionApp(
      parseActionEnv({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        ACTION_PORT: "4100",
        DATABASE_URL_ACTION: database.connectionStringFor("action_service"),
        DEMO_MODE: "true",
        ACTION_SERVICE_TOKEN: TOKEN,
      }),
      actionDatabase
    );
    actionUrl = await actionApp.listen({ host: "127.0.0.1", port: 0 });

    repository = createVerifierDatabase(database.connectionStringFor("verifier_api"));
    workerDatabase = createWorkerDatabase(database.connectionStringFor("verifier_worker"));
    const nextUuid = deterministicUuids();
    const issuer = createSimulatedIssuer({
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      issuerSecret: PHASE3_ISSUER_SECRET,
      now: () => now,
      randomBytes: deterministicBytes(0x61_05_20_26),
    });
    const protocol = createProtocolService({
      repository,
      issuer,
      verifier: createSimulatedVerifier({
        issuerKeyId: PHASE3_POLICY.issuerKeyId,
        issuerSecret: PHASE3_ISSUER_SECRET,
        demoMode: true,
        now: () => now,
      }),
      lookupProtection: createLookupProtection({
        ledgerKey: PHASE3_LEDGER_KEY,
        actionKey: PHASE3_ACTION_KEY,
      }),
      sha256Hex,
      now: () => now,
      randomUuid: nextUuid,
      randomBytes: deterministicBytes(0x06_00_00_01),
    });
    const faultController = createLostAckFaultController(repository, {
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      randomUuid: nextUuid,
    });
    const resetController = createDemoResetController({
      repository,
      actionClient: createActionSimulatorResetClient({
        actionServiceUrl: actionUrl,
        actionServiceToken: TOKEN,
      }),
      policyId: DEFAULT_POLICY_ID,
      policyVersion: DEFAULT_POLICY_VERSION,
      now: () => now,
      randomUuid: nextUuid,
    });
    apiApp = createApiApp(
      apiConfig(database.connectionStringFor("verifier_api")),
      repository.check,
      protocol,
      faultController,
      resetController
    );
    apiUrl = await apiApp.listen({ host: "127.0.0.1", port: 0 });

    const holder = createSimulatedHolder();
    const boundTest = createSimulatedBoundTestAdapter({
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      issuerSecret: PHASE3_ISSUER_SECRET,
      now: () => now,
      randomBytes: deterministicBytes(0x06_00_00_03),
    });
    let currentDemoRunId = "";

    const createChallenge = async (operationId: string): Promise<ChallengeResponse> => {
      const response = await fetch(`${apiUrl}/v1/verifier/challenges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: "AnonLimit/v1",
          policyId: PHASE3_POLICY.id,
          policyVersion: PHASE3_POLICY.version,
          audience: PHASE3_POLICY.audience,
          operationId,
          action: PHASE3_ACTION,
        }),
      });
      expect(response.status).toBe(201);
      return challengeResponseSchema.parse(await responseJson(response));
    };

    const submit = (prepared: GoldenPreparedPresentation<ScenarioPresentation>) =>
      fetch(`${apiUrl}/v1/verifier/presentations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": prepared.operationId,
        },
        body: prepared.value.serialized,
      });

    const waitForAccepted = async (operationId: string): Promise<string> => {
      if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const result = await database.pool.query<{ use_id: string }>(
          `SELECT u.use_id
           FROM verifier.use_records AS u
           JOIN verifier.outbox_events AS o ON o.use_id = u.use_id
           WHERE u.demo_run_id = $1
             AND u.operation_id = $2
             AND u.status = 'ACCEPTED_PENDING_ACTION'
             AND o.state = 'READY'`,
          [currentDemoRunId, operationId]
        );
        const useId = result.rows[0]?.use_id;
        if (useId) return useId;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("ACCEPTED_USE_UNAVAILABLE");
    };

    const deliverNextAction = async (): Promise<void> => {
      if (!workerDatabase) throw new Error("WORKER_DATABASE_UNAVAILABLE");
      const deadline = Date.now() + 3_000;
      let event: Awaited<ReturnType<typeof workerDatabase.claimOutboxBatch>>[number] | undefined;
      while (!event && Date.now() < deadline) {
        [event] = await workerDatabase.claimOutboxBatch(1, 30_000);
        if (!event) await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      if (!event) throw new Error("OUTBOX_EVENT_UNAVAILABLE");
      const delivery = await deliverAction(
        { actionServiceUrl: actionUrl, actionServiceToken: TOKEN },
        event,
        new AbortController().signal
      );
      if (delivery.kind !== "SUCCESS") throw new Error("ACTION_DELIVERY_FAILED");
      await workerDatabase.completeOutboxSuccess(event.eventId, delivery.response);
    };

    const waitForSucceeded = async (useId: string): Promise<GoldenCompletedUse> => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${apiUrl}/v1/verifier/uses/${useId}`);
        if (response.status === 200) {
          const status = useStatusResponseSchema.parse(await responseJson(response));
          if (status.status === "SUCCEEDED")
            return { useId: status.useId, receiptId: status.receipt.receiptId };
          if (status.status === "FAILED_FINAL") throw new Error(status.failureCode);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("SUCCEEDED_USE_UNAVAILABLE");
    };

    const snapshot = async (): Promise<GoldenBackendSnapshot> => {
      if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
      const active = await database.pool.query<{ demo_run_id: string }>(
        "SELECT demo_run_id FROM verifier.demo_runs WHERE status = 'ACTIVE'"
      );
      const demoRunId = active.rows[0]?.demo_run_id;
      if (!demoRunId || active.rows.length !== 1) throw new Error("ACTIVE_DEMO_RUN_UNAVAILABLE");
      const counts = await database.pool.query<{
        accepted_uses: number;
        outbox_events: number;
        committed_actions: number;
        distinct_receipts: number;
        consumed_challenges: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
              FROM verifier.use_records WHERE demo_run_id = $1) AS accepted_uses,
           (SELECT count(*)::integer
              FROM verifier.outbox_events AS o
              JOIN verifier.use_records AS u ON u.use_id = o.use_id
             WHERE u.demo_run_id = $1) AS outbox_events,
           (SELECT count(*)::integer
              FROM action_sim.action_results WHERE demo_run_id = $1) AS committed_actions,
           (SELECT count(DISTINCT receipt->>'receiptId')::integer
              FROM action_sim.action_results WHERE demo_run_id = $1) AS distinct_receipts,
           (SELECT count(*)::integer
              FROM verifier.verification_challenges
             WHERE demo_run_id = $1 AND state = 'CONSUMED') AS consumed_challenges`,
        [demoRunId]
      );
      const count = counts.rows[0];
      if (!count) throw new Error("TEST_DATABASE_INCONSISTENT");
      const receipts = await database.pool.query<{ use_id: string; receipt_id: string }>(
        `SELECT receipt->>'useId' AS use_id, receipt->>'receiptId' AS receipt_id
           FROM action_sim.action_results
          WHERE demo_run_id = $1
          ORDER BY receipt->>'useId'`,
        [demoRunId]
      );
      return {
        demoRunId,
        acceptedUses: count.accepted_uses,
        outboxEvents: count.outbox_events,
        committedActions: count.committed_actions,
        distinctReceipts: count.distinct_receipts,
        consumedChallenges: count.consumed_challenges,
        receipts: receipts.rows.map((receipt) => ({
          useId: receipt.use_id,
          receiptId: receipt.receipt_id,
        })),
      };
    };

    driver = {
      async reset(): Promise<GoldenResetResult> {
        const response = await fetch(`${apiUrl}/v1/demo/reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(response.status).toBe(200);
        const reset = demoResetResponseSchema.parse(await responseJson(response));
        currentDemoRunId = reset.demoRunId;
        return {
          demoRunId: reset.demoRunId,
          policy: {
            id: reset.policy.id,
            version: reset.policy.version,
            maxUses: reset.policy.maxUses,
          },
        };
      },
      async loadPolicy(reference: GoldenPolicyReference) {
        const response = await fetch(
          `${apiUrl}/v1/policies/${reference.id}/versions/${reference.version}`
        );
        expect(response.status).toBe(200);
        const policy = policySchema.parse(await responseJson(response));
        return { id: policy.id, version: policy.version, maxUses: policy.maxUses };
      },
      async issue(policy: GoldenPolicyReference) {
        const response = await fetch(`${apiUrl}/v1/issuer/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            protocolVersion: "AnonLimit/v1",
            policyId: policy.id,
            policyVersion: policy.version,
          }),
        });
        expect(response.status).toBe(200);
        const issued = issuanceResponseSchema.parse(await responseJson(response));
        expect(issued.demoRunId).toBe(currentDemoRunId);
        return issued;
      },
      async prepareAllowedUse(input) {
        const operationId = nextUuid();
        const challenge = await createChallenge(operationId);
        const presentation = await holder.createPresentation({
          credential: input.credential.credential,
          challenge,
          operationId,
          hiddenSlot: input.hiddenSlot,
          action: PHASE3_ACTION,
        });
        return {
          operationId,
          value: { presentation, serialized: JSON.stringify(presentation) },
        };
      },
      async prepareOutOfRangeUse(input) {
        expect(input.hiddenSlot).toBe(input.policy.maxUses);
        const operationId = nextUuid();
        const challenge = await createChallenge(operationId);
        const presentation = await boundTest.createOutOfRangePresentation({
          policy: PHASE3_POLICY,
          demoRunId: currentDemoRunId,
          operationId,
          action: PHASE3_ACTION,
          challenge,
        });
        return {
          operationId,
          value: { presentation, serialized: JSON.stringify(presentation) },
        };
      },
      async submitAndComplete(prepared) {
        const response = await submit(prepared);
        expect(response.status).toBe(202);
        const accepted = useResultSchema.parse(await responseJson(response));
        expect(accepted).toMatchObject({
          status: "ACCEPTED_PENDING_ACTION",
          code: "ACCEPTED_PENDING_ACTION",
          replayed: false,
          usageDelta: 1,
          actionDelta: 0,
        });
        await deliverNextAction();
        return waitForSucceeded(accepted.useId);
      },
      async armDropNextAcknowledgement(operationId) {
        const response = await fetch(`${apiUrl}/v1/demo/faults/drop-next-ack`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId }),
        });
        expect(response.status).toBe(200);
        expect(demoFaultResponseSchema.parse(await responseJson(response))).toMatchObject({
          demoRunId: currentDemoRunId,
          operationId,
          armed: true,
        });
      },
      async submitWithLostAcknowledgement(prepared, onAccepted) {
        const outcome = submit(prepared)
          .then(
            async (response) => {
              await response.json();
              return { kind: "RESPONSE" as const, status: response.status };
            },
            () => ({ kind: "CONNECTION_DROPPED" as const })
          )
          .catch(() => ({ kind: "CONNECTION_DROPPED" as const }));
        await waitForAccepted(prepared.operationId);
        await onAccepted();
        await deliverNextAction();
        const result = await outcome;
        expect(result).toEqual({ kind: "CONNECTION_DROPPED" });
        return "OUTCOME_UNKNOWN";
      },
      async retryExact(prepared): Promise<GoldenRetryResult> {
        const response = await submit(prepared);
        expect(response.status).toBe(200);
        const result = useResultSchema.parse(await responseJson(response));
        if (result.status !== "SUCCEEDED" || result.code !== "RETRY_RESOLVED")
          throw new Error("RETRY_DID_NOT_RESOLVE");
        return {
          useId: result.useId,
          receiptId: result.receipt.receiptId,
          code: "RETRY_RESOLVED",
          replayed: true,
          usageDelta: 0,
          actionDelta: 0,
        };
      },
      async submitOutOfRange(prepared): Promise<GoldenRejection> {
        const response = await submit(prepared);
        expect(response.status).toBe(422);
        const error = publicErrorSchema.parse(await responseJson(response));
        if (error.code !== "PRESENTATION_REJECTED")
          throw new Error("OVER_LIMIT_CODE_NOT_COLLAPSED");
        return {
          code: "PRESENTATION_REJECTED",
          usageDelta: error.usageDelta,
          actionDelta: error.actionDelta,
        };
      },
      snapshot,
    };
  }, 120_000);

  afterAll(async () => {
    await apiApp?.close();
    await workerDatabase?.close();
    await repository?.close();
    await actionApp?.close();
    await actionDatabase?.close();
    await database?.stop();
  }, 30_000);

  it("passes G6 twice from public reset while preserving unrelated run state", async () => {
    if (!driver || !database) throw new Error("TEST_DRIVER_UNAVAILABLE");

    const cannotSelectRun = await fetch(`${apiUrl}/v1/demo/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demoRunId: SENTINEL_RUN_ID }),
    });
    expect(cannotSelectRun.status).toBe(400);
    expect(publicErrorSchema.parse(await responseJson(cannotSelectRun)).code).toBe("BAD_REQUEST");

    const first = await runGoldenScenario(driver);
    expect(first.invariants).toEqual({
      declaredLimit: 3,
      acceptedDistinctUses: 3,
      committedExternalActions: 3,
      extraUsesFromRetry: 0,
      extraActionsFromRetry: 0,
      overLimitMutations: 0,
      allReceiptsStable: true,
    });
    expect(first.checkpoints.map((checkpoint) => checkpoint.name)).toEqual([
      "RESET",
      "POLICY_LOADED",
      "CREDENTIAL_ISSUED",
      "SLOT_0_SUCCEEDED",
      "DROP_ACK_ARMED",
      "SLOT_1_ACCEPTED",
      "SLOT_1_OUTCOME_UNKNOWN",
      "SLOT_1_RETRY_RESOLVED",
      "SLOT_2_SUCCEEDED",
      "SLOT_3_REJECTED",
    ]);

    const second = await runGoldenScenario(driver);
    expect(second.demoRunId).not.toBe(first.demoRunId);
    expect(second.invariants).toEqual(first.invariants);

    const preserved = await database.pool.query<{
      verifier_runs: number;
      action_rows: number;
      receipt_id: string | null;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM verifier.demo_runs WHERE demo_run_id = $1) AS verifier_runs,
         (SELECT count(*)::integer FROM action_sim.action_results WHERE demo_run_id = $1) AS action_rows,
         (SELECT receipt->>'receiptId' FROM action_sim.action_results WHERE demo_run_id = $1)
           AS receipt_id`,
      [SENTINEL_RUN_ID]
    );
    expect(preserved.rows).toEqual([
      { verifier_runs: 1, action_rows: 1, receipt_id: SENTINEL_RECEIPT_ID },
    ]);

    const firstRunAfterReset = await database.pool.query<{
      verifier_rows: number;
      action_rows: number;
      reset_fences: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM verifier.demo_runs WHERE demo_run_id = $1)
           AS verifier_rows,
         (SELECT count(*)::integer FROM action_sim.action_results WHERE demo_run_id = $1)
           AS action_rows,
         (SELECT count(*)::integer FROM action_sim.reset_demo_runs WHERE demo_run_id = $1)
           AS reset_fences`,
      [first.demoRunId]
    );
    expect(firstRunAfterReset.rows).toEqual([
      { verifier_rows: 0, action_rows: 0, reset_fences: 1 },
    ]);
  }, 60_000);
});
