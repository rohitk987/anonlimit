import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseActionEnv } from "@anonlimit/config/server";
import { createActionDatabase } from "../../packages/db/src/action.js";
import { createApp as createActionApp } from "../../apps/action-simulator/src/app.js";
import { deliverAction } from "../../apps/worker/src/action-client.js";
import { createWorkerDatabase } from "../../packages/db/src/verifier/worker-repository.js";
import { DEFAULT_DEMO_RUN_ID, seedDefaultPolicy } from "../../packages/db/src/seed.js";
import { startPhase3Postgres, type Phase3Postgres } from "../helpers/phase3-postgres.js";

const TOKEN = "phase9-recovery-token-" + "x".repeat(48);
const ACTION = { type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } } as const;

interface PendingAction {
  readonly eventId: string;
  readonly useId: string;
  readonly actionKey: string;
  readonly payloadDigest: string;
  readonly intentDigest: string;
  readonly action: typeof ACTION;
}

function id(suffix: string): string {
  return `90000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

describe.sequential("Phase 9 outbox lease and crash recovery", () => {
  let database: Phase3Postgres | undefined;
  let actionDatabase: ReturnType<typeof createActionDatabase> | undefined;
  let actionApp: Awaited<ReturnType<typeof createActionApp>> | undefined;
  let actionUrl = "";

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await seedDefaultPolicy(database.ownerConnectionString);
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
               action_sim.action_results
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await actionApp?.close();
    await actionDatabase?.close();
    await database?.stop();
  }, 30_000);

  async function seedPendingAction(sequence: number): Promise<PendingAction> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const suffix = sequence.toString(16).padStart(2, "0");
    const challengeId = id(`${suffix}01`);
    const useId = id(`${suffix}02`);
    const eventId = id(`${suffix}03`);
    const operationId = id(`${suffix}04`);
    const actionKey = `hmac-sha256:${suffix.slice(-1).repeat(64)}`;
    const payloadDigest = `sha256:${"a".repeat(62)}${suffix}`;
    const intentDigest = `sha256:${"b".repeat(64)}`;
    const scopeHash = `sha256:${"c".repeat(64)}`;
    const nullifierKey = `hmac-sha256:${"d".repeat(64)}`;
    const policy = await database.pool.query<{ policy_digest: string }>(
      "SELECT policy_digest FROM verifier.quota_policies WHERE policy_id = 'anon-demo' AND version = 1"
    );
    const policyDigest = policy.rows[0]?.policy_digest;
    if (!policyDigest) throw new Error("POLICY_UNAVAILABLE");
    await database.pool.query(
      `INSERT INTO verifier.verification_challenges
         (challenge_id, demo_run_id, nonce_hash, policy_id, policy_version,
          operation_id, intent_digest, scope_hash, policy_digest,
          expires_at, state)
       VALUES ($1,$2,$3,'anon-demo',1,$4,$5,$6,$7,clock_timestamp()+interval '1 hour','ISSUED')`,
      [
        challengeId,
        DEFAULT_DEMO_RUN_ID,
        `sha256:${"e".repeat(64)}`,
        operationId,
        intentDigest,
        scopeHash,
        policyDigest,
      ]
    );
    await database.pool.query(
      `INSERT INTO verifier.use_records
         (use_id, demo_run_id, challenge_id, scope_hash, nullifier_key,
          operation_id, intent_digest, status, action_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ACCEPTED_PENDING_ACTION',$8)`,
      [
        useId,
        DEFAULT_DEMO_RUN_ID,
        challengeId,
        scopeHash,
        nullifierKey,
        operationId,
        intentDigest,
        actionKey,
      ]
    );
    await database.pool.query(
      "UPDATE verifier.verification_challenges SET state = 'CONSUMED', use_id = $2 WHERE challenge_id = $1",
      [challengeId, useId]
    );
    await database.pool.query(
      `INSERT INTO verifier.outbox_events
         (event_id, use_id, event_type, action_key, payload_digest, safe_payload,
          policy_id, policy_version)
       VALUES ($1,$2,'COMMIT_DEMO_ACTION',$3,$4,$5::jsonb,'anon-demo',1)`,
      [eventId, useId, actionKey, payloadDigest, JSON.stringify(ACTION)]
    );
    return { eventId, useId, actionKey, payloadDigest, intentDigest, action: ACTION };
  }

  function worker() {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    return createWorkerDatabase(database.connectionStringFor("verifier_worker"));
  }

  async function expireLease(eventId: string): Promise<void> {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    await database.pool.query(
      "UPDATE verifier.outbox_events SET lease_until = clock_timestamp() - interval '1 millisecond' WHERE event_id = $1",
      [eventId]
    );
  }

  async function databaseState() {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const result = await database.pool.query<{
      use_status: string;
      outbox_state: string;
      attempt_count: number;
      actions: number;
      receipt_id: string | null;
      next_attempt_at: Date | string;
      last_error_code: string | null;
    }>(
      `SELECT u.status AS use_status, o.state AS outbox_state, o.attempt_count,
              (SELECT count(*)::integer FROM action_sim.action_results) AS actions,
              (SELECT receipt->>'receiptId' FROM action_sim.action_results LIMIT 1) AS receipt_id,
              o.next_attempt_at, o.last_error_code
       FROM verifier.outbox_events AS o
       JOIN verifier.use_records AS u ON u.use_id = o.use_id`
    );
    const row = result.rows[0];
    if (!row) throw new Error("OUTBOX_STATE_UNAVAILABLE");
    return row;
  }

  it("gives two workers disjoint live leases", async () => {
    const pending = await seedPendingAction(1);
    const first = worker();
    const second = worker();
    try {
      const [firstBatch, secondBatch] = await Promise.all([
        first.claimOutboxBatch(1, 30_000),
        second.claimOutboxBatch(1, 30_000),
      ]);
      expect(firstBatch.length + secondBatch.length).toBe(1);
      expect(firstBatch[0]?.eventId ?? secondBatch[0]?.eventId).toBe(pending.eventId);
      expect(new Set([...firstBatch, ...secondBatch].map((event) => event.eventId)).size).toBe(1);
      const state = await databaseState();
      expect(state.outbox_state).toBe("LEASED");
      expect(state.attempt_count).toBe(1);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("recovers an expired lease without allocating a second event", async () => {
    const pending = await seedPendingAction(2);
    const first = worker();
    const second = worker();
    try {
      expect(await first.claimOutboxBatch(1, 30_000)).toHaveLength(1);
      await expireLease(pending.eventId);
      const recovered = await second.claimOutboxBatch(1, 30_000);
      expect(recovered).toHaveLength(1);
      expect(recovered[0]?.eventId).toBe(pending.eventId);
      expect(recovered[0]?.attemptCount).toBe(2);
      const count = await database?.pool.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM verifier.outbox_events"
      );
      expect(count?.rows[0]?.count).toBe(1);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("recovers durable work after a worker exits before delivery", async () => {
    const pending = await seedPendingAction(3);
    const crashed = worker();
    const recovered = worker();
    try {
      expect(await crashed.claimOutboxBatch(1, 30_000)).toHaveLength(1);
      await expireLease(pending.eventId);
      const [event] = await recovered.claimOutboxBatch(1, 30_000);
      if (!event) throw new Error("RECOVERED_EVENT_UNAVAILABLE");
      const delivery = await deliverAction(
        { actionServiceUrl: actionUrl, actionServiceToken: TOKEN },
        event,
        new AbortController().signal
      );
      expect(delivery.kind).toBe("SUCCESS");
      if (delivery.kind !== "SUCCESS") throw new Error("DELIVERY_FAILED");
      await recovered.completeOutboxSuccess(event.eventId, delivery.response);
      await expect(databaseState()).resolves.toMatchObject({
        use_status: "SUCCEEDED",
        outbox_state: "DELIVERED",
        attempt_count: 2,
        actions: 1,
      });
    } finally {
      await crashed.close();
      await recovered.close();
    }
  });

  it("redelivers after an external commit and keeps the original receipt", async () => {
    const pending = await seedPendingAction(4);
    const crashed = worker();
    const recovered = worker();
    try {
      const [firstEvent] = await crashed.claimOutboxBatch(1, 30_000);
      if (!firstEvent) throw new Error("FIRST_EVENT_UNAVAILABLE");
      const firstDelivery = await deliverAction(
        { actionServiceUrl: actionUrl, actionServiceToken: TOKEN },
        firstEvent,
        new AbortController().signal
      );
      expect(firstDelivery.kind).toBe("SUCCESS");
      if (firstDelivery.kind !== "SUCCESS") throw new Error("FIRST_DELIVERY_FAILED");
      const originalReceipt = firstDelivery.response.receipt;

      await expireLease(pending.eventId);
      const [redeliveredEvent] = await recovered.claimOutboxBatch(1, 30_000);
      if (!redeliveredEvent) throw new Error("REDELIVERY_EVENT_UNAVAILABLE");
      const replay = await deliverAction(
        { actionServiceUrl: actionUrl, actionServiceToken: TOKEN },
        redeliveredEvent,
        new AbortController().signal
      );
      expect(replay).toMatchObject({ kind: "SUCCESS", response: { replayed: true } });
      if (replay.kind !== "SUCCESS") throw new Error("REDELIVERY_FAILED");
      expect(replay.response.receipt).toEqual(originalReceipt);
      await recovered.completeOutboxSuccess(redeliveredEvent.eventId, replay.response);
      await expect(databaseState()).resolves.toMatchObject({
        use_status: "SUCCEEDED",
        outbox_state: "DELIVERED",
        attempt_count: 2,
        actions: 1,
        receipt_id: originalReceipt.receiptId,
      });
    } finally {
      await crashed.close();
      await recovered.close();
    }
  });

  it("uses bounded exponential retry and exposes exhaustion as DEAD_LETTER", async () => {
    const pending = await seedPendingAction(5);
    const workerDatabase = worker();
    try {
      const first = await workerDatabase.claimOutboxBatch(1, 30_000);
      expect(first).toHaveLength(1);
      await workerDatabase.retryOutbox(pending.eventId, "ACTION_SERVICE_UNAVAILABLE", 3);
      const afterFirst = await databaseState();
      expect(afterFirst).toMatchObject({
        outbox_state: "READY",
        attempt_count: 1,
        last_error_code: "ACTION_SERVICE_UNAVAILABLE",
      });
      expect(Date.parse(String(afterFirst.next_attempt_at))).toBeGreaterThan(Date.now());
      let previousRetryAt = Date.parse(String(afterFirst.next_attempt_at));

      for (const expectedAttempt of [2, 3]) {
        await database?.pool.query(
          "UPDATE verifier.outbox_events SET next_attempt_at = clock_timestamp() WHERE event_id = $1",
          [pending.eventId]
        );
        expect(await workerDatabase.claimOutboxBatch(1, 30_000)).toHaveLength(1);
        await workerDatabase.retryOutbox(pending.eventId, "ACTION_SERVICE_UNAVAILABLE", 3);
        const state = await databaseState();
        expect(state.attempt_count).toBe(expectedAttempt);
        const nextRetryAt = Date.parse(String(state.next_attempt_at));
        if (expectedAttempt < 3) expect(nextRetryAt).toBeGreaterThan(previousRetryAt);
        previousRetryAt = nextRetryAt;
        if (expectedAttempt === 3)
          expect(state).toMatchObject({
            use_status: "FAILED_FINAL",
            outbox_state: "DEAD_LETTER",
            last_error_code: "ACTION_SERVICE_UNAVAILABLE",
            actions: 0,
          });
      }
    } finally {
      await workerDatabase.close();
    }
  });
});
