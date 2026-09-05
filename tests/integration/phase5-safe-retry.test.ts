import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseActionEnv, type ApiEnv } from "@anonlimit/config/server";
import {
  challengeResponseSchema,
  demoFaultResponseSchema,
  issuanceResponseSchema,
  publicErrorSchema,
  useResultSchema,
  type ChallengeResponse,
  type IssuanceResponse,
  type Presentation,
} from "@anonlimit/contracts";
import { createSimulatedIssuer } from "@anonlimit/crypto/issuer";
import {
  createLookupProtection,
  createSimulatedVerifier,
  sha256Hex,
} from "@anonlimit/crypto/verifier";
import { createActionDatabase } from "@anonlimit/db/action";
import { seedDefaultPolicy } from "@anonlimit/db/seed";
import {
  createVerifierDatabase,
  createWorkerDatabase,
  type VerifierDatabase,
} from "@anonlimit/db/verifier";
import { createApp as createActionApp } from "../../apps/action-simulator/src/app.js";
import { createApp as createApiApp } from "../../apps/api/src/app.js";
import { createLostAckFaultController } from "../../apps/api/src/modules/demo/fault-controller.js";
import {
  createProtocolService,
  type ProtocolRepository,
} from "../../apps/api/src/modules/protocol/protocol-service.js";
import { deliverAction } from "../../apps/worker/src/action-client.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";
import {
  createPhase3Presentation,
  PHASE3_ACTION,
  PHASE3_ACTION_KEY,
  PHASE3_ISSUER_SECRET,
  PHASE3_LEDGER_KEY,
  PHASE3_POLICY,
} from "../helpers/phase3-protocol.js";

const TOKEN = "phase5-action-token-" + "x".repeat(48);

interface Candidate {
  readonly challenge: ChallengeResponse;
  readonly issuance: IssuanceResponse;
  readonly presentation: Presentation;
  readonly serialized: string;
}

interface Counts {
  readonly uses: number;
  readonly outbox: number;
  readonly actions: number;
  readonly receipts: number;
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
    issuerPrivateKeyPath: "/phase5-test/issuer.key",
    issuerPublicParametersPath: "/phase5-test/issuer-public.json",
  };
}

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function changedNullifier(nullifier: string): string {
  const replacement = nullifier.endsWith("0") ? "1" : "0";
  return nullifier.slice(0, -1) + replacement;
}

describe.sequential("Phase 5 lost acknowledgement and exact retry", () => {
  let database: Phase3Postgres | undefined;
  let repository: VerifierDatabase | undefined;
  let workerDatabase: ReturnType<typeof createWorkerDatabase> | undefined;
  let actionDatabase: ReturnType<typeof createActionDatabase> | undefined;
  let actionApp: ReturnType<typeof createActionApp> | undefined;
  let apiApp: ReturnType<typeof createApiApp> | undefined;
  let actionUrl = "";
  let apiUrl = "";
  let clock = Date.now();

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await seedDefaultPolicy(database.ownerConnectionString, {
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      now: () => clock,
    });
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
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    await database.pool.query(`
      TRUNCATE verifier.protocol_events, verifier.outbox_events,
               verifier.use_records, verifier.verification_challenges,
               verifier.demo_faults, action_sim.action_results
      RESTART IDENTITY CASCADE
    `);
    const current = await database.pool.query<{ current_time: Date | string }>(
      "SELECT clock_timestamp() AS current_time"
    );
    const currentTime = current.rows[0]?.current_time;
    if (!currentTime) throw new Error("TEST_DATABASE_INCONSISTENT");
    clock = new Date(currentTime).getTime();
    repository = createVerifierDatabase(database.connectionStringFor("verifier_api"));
    workerDatabase = createWorkerDatabase(database.connectionStringFor("verifier_worker"));
    await startApi(repository);
  });

  afterEach(async () => {
    await apiApp?.close();
    await workerDatabase?.close();
    await repository?.close();
    apiApp = undefined;
    workerDatabase = undefined;
    repository = undefined;
  });

  afterAll(async () => {
    await actionApp?.close();
    await actionDatabase?.close();
    await database?.stop();
  }, 30_000);

  async function startApi(
    protocolRepository: ProtocolRepository,
    faultWaitTimeoutMs = 5_000
  ): Promise<void> {
    if (!database || !repository) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const issuer = createSimulatedIssuer({
      issuerKeyId: PHASE3_POLICY.issuerKeyId,
      issuerSecret: PHASE3_ISSUER_SECRET,
      now: () => clock,
    });
    const protocol = createProtocolService({
      repository: protocolRepository,
      issuer,
      verifier: createSimulatedVerifier({
        issuerKeyId: PHASE3_POLICY.issuerKeyId,
        issuerSecret: PHASE3_ISSUER_SECRET,
        now: () => clock,
      }),
      lookupProtection: createLookupProtection({
        ledgerKey: PHASE3_LEDGER_KEY,
        actionKey: PHASE3_ACTION_KEY,
      }),
      sha256Hex,
      now: () => clock,
    });
    const faultController = createLostAckFaultController(repository, {
      timeoutMs: faultWaitTimeoutMs,
      pollIntervalMs: 10,
    });
    apiApp = createApiApp(
      apiConfig(database.connectionStringFor("verifier_api")),
      repository.check,
      protocol,
      faultController
    );
    apiUrl = await apiApp.listen({ host: "127.0.0.1", port: 0 });
  }

  async function restartApi(
    protocolRepository: ProtocolRepository,
    faultWaitTimeoutMs = 5_000
  ): Promise<void> {
    await apiApp?.close();
    apiApp = undefined;
    await startApi(protocolRepository, faultWaitTimeoutMs);
  }

  async function createCandidate(hiddenSlot = 0): Promise<Candidate> {
    const operationId = crypto.randomUUID();
    const issuedResponse = await fetch(`${apiUrl}/v1/issuer/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "AnonLimit/v1",
        policyId: PHASE3_POLICY.id,
        policyVersion: PHASE3_POLICY.version,
      }),
    });
    expect(issuedResponse.status).toBe(200);
    const issuance = issuanceResponseSchema.parse(await json(issuedResponse));
    const challengeResponse = await fetch(`${apiUrl}/v1/verifier/challenges`, {
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
    expect(challengeResponse.status).toBe(201);
    const challenge = challengeResponseSchema.parse(await json(challengeResponse));
    const presentation = await createPhase3Presentation({
      credential: issuance.credential,
      challenge,
      operationId,
      hiddenSlot,
    });
    return { challenge, issuance, presentation, serialized: JSON.stringify(presentation) };
  }

  function submit(serialized: string, operationId: string): Promise<Response> {
    return fetch(`${apiUrl}/v1/verifier/presentations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": operationId,
      },
      body: serialized,
    });
  }

  async function deliverNextAction(): Promise<void> {
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
  }

  async function counts(): Promise<Counts> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const result = await database.pool.query<Counts>(`
      SELECT
        (SELECT count(*)::integer FROM verifier.use_records) AS uses,
        (SELECT count(*)::integer FROM verifier.outbox_events) AS outbox,
        (SELECT count(*)::integer FROM action_sim.action_results) AS actions,
        (SELECT count(DISTINCT receipt->>'receiptId')::integer
         FROM action_sim.action_results) AS receipts
    `);
    const row = result.rows[0];
    if (!row) throw new Error("TEST_DATABASE_INCONSISTENT");
    return row;
  }

  async function waitForAcceptedUse(operationId: string): Promise<string> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const result = await database.pool.query<{ use_id: string }>(
        `SELECT u.use_id
         FROM verifier.use_records AS u
         JOIN verifier.outbox_events AS o ON o.use_id = u.use_id
         WHERE u.operation_id = $1
           AND u.status = 'ACCEPTED_PENDING_ACTION'
           AND o.state = 'READY'`,
        [operationId]
      );
      const useId = result.rows[0]?.use_id;
      if (useId) return useId;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("ACCEPTED_USE_UNAVAILABLE");
  }

  it("drops only a durable acknowledgement and recovers the original receipt with zero deltas", async () => {
    if (!database || !repository) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const candidate = await createCandidate();
    const armResponse = await fetch(`${apiUrl}/v1/demo/faults/drop-next-ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId: candidate.presentation.operationId }),
    });
    expect(armResponse.status).toBe(200);
    expect(demoFaultResponseSchema.parse(await json(armResponse))).toMatchObject({
      demoRunId: candidate.issuance.demoRunId,
      operationId: candidate.presentation.operationId,
      fault: "DROP_NEXT_ACK_AFTER_COMMIT",
      armed: true,
    });

    let acknowledgementSettled = false;
    const lostAcknowledgement = submit(candidate.serialized, candidate.presentation.operationId)
      .then(
        async (response) => {
          await response.json();
          return { kind: "RESPONSE" as const, status: response.status };
        },
        () => ({ kind: "CONNECTION_DROPPED" as const })
      )
      .catch(() => ({ kind: "CONNECTION_DROPPED" as const }))
      .finally(() => {
        acknowledgementSettled = true;
      });
    const acceptedUseId = await waitForAcceptedUse(candidate.presentation.operationId);
    expect(acknowledgementSettled).toBe(false);
    expect(await counts()).toEqual({ uses: 1, outbox: 1, actions: 0, receipts: 0 });
    const eventsBeforeDelivery = await database.pool.query<{ acknowledgements: number }>(
      `SELECT count(*)::integer AS acknowledgements
       FROM verifier.protocol_events
       WHERE event_name = 'ACK_DROPPED'`
    );
    expect(eventsBeforeDelivery.rows).toEqual([{ acknowledgements: 0 }]);
    await deliverNextAction();
    expect(await lostAcknowledgement).toEqual({ kind: "CONNECTION_DROPPED" });

    const originalStatus = await repository.getUseStatus(acceptedUseId);
    if (originalStatus?.status !== "SUCCEEDED") throw new Error("RECEIPT_NOT_DURABLE");
    expect(await counts()).toEqual({ uses: 1, outbox: 1, actions: 1, receipts: 1 });
    const beforeRetry = await counts();
    clock = Date.parse(candidate.challenge.expiresAt);

    const retryResponse = await submit(candidate.serialized, candidate.presentation.operationId);
    expect(retryResponse.status).toBe(200);
    const retry = useResultSchema.parse(await json(retryResponse));
    expect(retry).toEqual({
      useId: originalStatus.useId,
      status: "SUCCEEDED",
      code: "RETRY_RESOLVED",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
      receipt: originalStatus.receipt,
    });
    expect(await counts()).toEqual(beforeRetry);

    const events = await database.pool.query<{
      event_name: string;
      usage_delta: number;
      action_delta: number;
    }>(
      `SELECT event_name, usage_delta, action_delta
       FROM verifier.protocol_events
       WHERE event_name IN ('ACK_DROPPED','RETRY_MATCHED','RETRY_RESOLVED','CACHED_RECEIPT_RETURNED')
       ORDER BY sequence`
    );
    expect(events.rows).toEqual([
      { event_name: "ACK_DROPPED", usage_delta: 0, action_delta: 0 },
      { event_name: "RETRY_MATCHED", usage_delta: 0, action_delta: 0 },
      { event_name: "RETRY_RESOLVED", usage_delta: 0, action_delta: 0 },
      { event_name: "CACHED_RECEIPT_RETURNED", usage_delta: 0, action_delta: 0 },
    ]);
    const fault = await database.pool.query<{ enabled: boolean }>(
      "SELECT enabled FROM verifier.demo_faults WHERE fault_name = 'DROP_NEXT_ACK'"
    );
    expect(fault.rows).toEqual([{ enabled: false }]);

    const immutableBefore = await database.pool.query(
      `SELECT demo_run_id, scope_hash, nullifier_key, operation_id,
              intent_digest, action_key, status, cached_result
       FROM verifier.use_records WHERE use_id = $1`,
      [originalStatus.useId]
    );
    const changedIntent = await submit(
      JSON.stringify({
        ...candidate.presentation,
        action: { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "WORKSHOP" } },
      }),
      candidate.presentation.operationId
    );
    expect(changedIntent.status).toBe(409);
    expect(publicErrorSchema.parse(await json(changedIntent)).code).toBe(
      "NULLIFIER_REUSE_CONFLICT"
    );
    const changedOperationContent = await submit(
      JSON.stringify({
        ...candidate.presentation,
        nullifier: changedNullifier(candidate.presentation.nullifier),
      }),
      candidate.presentation.operationId
    );
    expect(changedOperationContent.status).toBe(409);
    expect(publicErrorSchema.parse(await json(changedOperationContent)).code).toBe(
      "IDEMPOTENCY_CONFLICT"
    );
    const immutableAfter = await database.pool.query(
      `SELECT demo_run_id, scope_hash, nullifier_key, operation_id,
              intent_digest, action_key, status, cached_result
       FROM verifier.use_records WHERE use_id = $1`,
      [originalStatus.useId]
    );
    expect(immutableAfter.rows).toEqual(immutableBefore.rows);
    expect(await counts()).toEqual(beforeRetry);
  });

  it("recovers when the API fails immediately after the acceptance commit", async () => {
    if (!database || !repository) throw new Error("TEST_DATABASE_UNAVAILABLE");
    let failAfterCommit = true;
    const underlying = repository;
    const proxy: ProtocolRepository = {
      ...underlying,
      async acceptPresentation(input) {
        const accepted = await underlying.acceptPresentation(input);
        if (failAfterCommit) {
          failAfterCommit = false;
          throw new Error("SIMULATED_API_FAILURE_AFTER_COMMIT");
        }
        return accepted;
      },
    };
    await restartApi(proxy);
    const candidate = await createCandidate();
    const first = await submit(candidate.serialized, candidate.presentation.operationId);
    expect(first.status).toBe(500);
    expect(publicErrorSchema.parse(await json(first)).code).toBe("INTERNAL_ERROR");
    expect(await counts()).toEqual({ uses: 1, outbox: 1, actions: 0, receipts: 0 });

    clock = Date.parse(candidate.challenge.expiresAt);
    const pendingRetryResponse = await submit(
      candidate.serialized,
      candidate.presentation.operationId
    );
    expect(pendingRetryResponse.status).toBe(202);
    expect(useResultSchema.parse(await json(pendingRetryResponse))).toMatchObject({
      status: "ACCEPTED_PENDING_ACTION",
      code: "RETRY_IN_PROGRESS",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
    });
    expect(await counts()).toEqual({ uses: 1, outbox: 1, actions: 0, receipts: 0 });

    await deliverNextAction();
    const resolvedResponse = await submit(candidate.serialized, candidate.presentation.operationId);
    expect(resolvedResponse.status).toBe(200);
    expect(useResultSchema.parse(await json(resolvedResponse))).toMatchObject({
      status: "SUCCEEDED",
      code: "RETRY_RESOLVED",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
    });
    expect(await counts()).toEqual({ uses: 1, outbox: 1, actions: 1, receipts: 1 });
  });

  it("returns a recoverable error and clears the fault when durable completion misses its bound", async () => {
    if (!database || !repository) throw new Error("TEST_DATABASE_UNAVAILABLE");
    await restartApi(repository, 40);
    const candidate = await createCandidate();
    const armResponse = await fetch(`${apiUrl}/v1/demo/faults/drop-next-ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId: candidate.presentation.operationId }),
    });
    expect(armResponse.status).toBe(200);

    const timedOut = await submit(candidate.serialized, candidate.presentation.operationId);
    expect(timedOut.status).toBe(503);
    expect(publicErrorSchema.parse(await json(timedOut))).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      usageDelta: 0,
      actionDelta: 0,
    });
    expect(await counts()).toEqual({ uses: 1, outbox: 1, actions: 0, receipts: 0 });
    const fault = await database.pool.query<{
      enabled: boolean;
      demo_run_id: string | null;
      operation_id: string | null;
    }>(
      `SELECT enabled, demo_run_id, operation_id
       FROM verifier.demo_faults
       WHERE fault_name = 'DROP_NEXT_ACK'`
    );
    expect(fault.rows).toEqual([{ enabled: false, demo_run_id: null, operation_id: null }]);

    const pendingRetry = await submit(candidate.serialized, candidate.presentation.operationId);
    expect(pendingRetry.status).toBe(202);
    expect(useResultSchema.parse(await json(pendingRetry))).toMatchObject({
      code: "RETRY_IN_PROGRESS",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
    });
    await deliverNextAction();
    const resolvedRetry = await submit(candidate.serialized, candidate.presentation.operationId);
    expect(resolvedRetry.status).toBe(200);
    expect(useResultSchema.parse(await json(resolvedRetry))).toMatchObject({
      code: "RETRY_RESOLVED",
      replayed: true,
      usageDelta: 0,
      actionDelta: 0,
    });
    expect(await counts()).toEqual({ uses: 1, outbox: 1, actions: 1, receipts: 1 });
  });
});
