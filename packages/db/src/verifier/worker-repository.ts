import { createHash, randomUUID } from "node:crypto";
import {
  actionSchema,
  internalActionResponseSchema,
  receiptSchema,
  type InternalActionResponse,
  type Receipt,
} from "@anonlimit/contracts";
import { createConnectionLifecycle, createPool } from "../connection.js";

export interface ClaimedOutboxEvent {
  readonly eventId: string;
  readonly useId: string;
  readonly demoRunId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly actionKey: string;
  readonly payloadDigest: string;
  readonly intentDigest: string;
  readonly action: ReturnType<typeof actionSchema.parse>;
  readonly attemptCount: number;
}

interface ClaimedRow {
  readonly event_id: string;
  readonly use_id: string;
  readonly demo_run_id: string;
  readonly policy_id: string | null;
  readonly policy_version: number | null;
  readonly action_key: string;
  readonly payload_digest: string;
  readonly intent_digest: string;
  readonly safe_payload: unknown;
  readonly attempt_count: number;
}

interface CompletionRow {
  readonly use_id: string;
  readonly demo_run_id: string;
  readonly policy_id: string | null;
  readonly policy_version: number | null;
  readonly action_key: string;
  readonly status: string;
}

export interface WorkerDatabase {
  check(): Promise<void>;
  close(): Promise<void>;
  claimOutboxBatch(limit: number, leaseMs: number): Promise<readonly ClaimedOutboxEvent[]>;
  completeOutboxSuccess(eventId: string, response: InternalActionResponse): Promise<void>;
  failOutbox(
    eventId: string,
    failureCode: "ACTION_FAILED_FINAL" | "ACTION_INTEGRITY_CONFLICT"
  ): Promise<void>;
  retryOutbox(eventId: string, errorCode: string, maxAttempts?: number): Promise<void>;
}

export function createWorkerDatabase(connectionString: string): WorkerDatabase {
  const pool = createPool(connectionString);
  const lifecycle = createConnectionLifecycle(pool);

  const claimOutboxBatch = async (limit: number, leaseMs: number) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("CONFIGURATION_INVALID");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000)
      throw new Error("CONFIGURATION_INVALID");
    const result = await pool.query<ClaimedRow>(
      `WITH candidates AS (
         SELECT o.event_id
         FROM verifier.outbox_events AS o
         WHERE o.state IN ('READY', 'LEASED')
           AND o.next_attempt_at <= clock_timestamp()
           AND (o.lease_until IS NULL OR o.lease_until < clock_timestamp())
         ORDER BY o.created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE verifier.outbox_events AS o
       SET state = 'LEASED',
           lease_until = clock_timestamp() + ($2 * INTERVAL '1 millisecond'),
           attempt_count = o.attempt_count + 1
       FROM candidates AS c, verifier.use_records AS u
       WHERE o.event_id = c.event_id AND u.use_id = o.use_id
       RETURNING o.event_id, o.use_id, u.demo_run_id, o.policy_id, o.policy_version,
                 o.action_key, o.payload_digest, u.intent_digest, o.safe_payload, o.attempt_count`,
      [limit, leaseMs]
    );
    return result.rows.map((row) => {
      if (!row.policy_id || !Number.isInteger(row.policy_version))
        throw new Error("DATABASE_INCONSISTENT");
      const policyVersion = row.policy_version as number;
      return {
        eventId: row.event_id,
        useId: row.use_id,
        demoRunId: row.demo_run_id,
        policyId: row.policy_id,
        policyVersion,
        actionKey: row.action_key,
        payloadDigest: row.payload_digest,
        intentDigest: row.intent_digest,
        action: actionSchema.parse(row.safe_payload),
        attemptCount: row.attempt_count,
      } satisfies ClaimedOutboxEvent;
    });
  };

  const completeOutboxSuccess = async (eventId: string, rawResponse: InternalActionResponse) => {
    const response = internalActionResponseSchema.parse(rawResponse);
    const receipt: Receipt = receiptSchema.parse(response.receipt);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const event = await client.query<CompletionRow>(
        `SELECT o.use_id, u.demo_run_id, o.policy_id, o.policy_version,
                o.action_key, u.status
         FROM verifier.outbox_events AS o
         JOIN verifier.use_records AS u ON u.use_id = o.use_id
         WHERE o.event_id = $1
         FOR UPDATE`,
        [eventId]
      );
      const row = event.rows[0];
      if (!row) throw new Error("DATABASE_INCONSISTENT");
      if (row.action_key !== receipt.actionKey || row.use_id !== receipt.useId)
        throw new Error("ACTION_RESPONSE_MISMATCH");
      if (row.status === "SUCCEEDED") {
        await client.query("COMMIT");
        return;
      }
      if (row.status !== "ACCEPTED_PENDING_ACTION" || !row.policy_id || !row.policy_version)
        throw new Error("DATABASE_INCONSISTENT");
      await client.query(
        `UPDATE verifier.use_records
         SET status = 'SUCCEEDED', cached_result = $2::jsonb,
             completed_at = clock_timestamp(), failure_code = NULL
         WHERE use_id = $1 AND status = 'ACCEPTED_PENDING_ACTION'`,
        [row.use_id, JSON.stringify(receipt)]
      );
      await client.query(
        `UPDATE verifier.outbox_events
         SET state = 'DELIVERED', lease_until = NULL, delivered_at = clock_timestamp(), last_error_code = NULL
         WHERE event_id = $1 AND state = 'LEASED'`,
        [eventId]
      );
      await client.query(
        `INSERT INTO verifier.protocol_events (
           event_id, event_name, trace_id, demo_run_id, policy_id, policy_version,
           from_state, to_state, decision_code, usage_delta, action_delta, masked_use_ref
         ) VALUES ($1,'EXTERNAL_ACTION_COMMITTED',$2,$3,$4,$5,
                   'ACCEPTED_PENDING_ACTION','SUCCEEDED','EXTERNAL_ACTION_COMMITTED',0,1,$6)`,
        [
          randomUUID(),
          randomUUID(),
          row.demo_run_id,
          row.policy_id,
          row.policy_version,
          `use_${createHash("sha256").update(row.use_id, "utf8").digest("hex").slice(0, 12)}`,
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const failOutbox = async (
    eventId: string,
    failureCode: "ACTION_FAILED_FINAL" | "ACTION_INTEGRITY_CONFLICT"
  ) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<CompletionRow>(
        `SELECT o.use_id, u.demo_run_id, o.policy_id, o.policy_version,
                o.action_key, u.status
         FROM verifier.outbox_events AS o
         JOIN verifier.use_records AS u ON u.use_id = o.use_id
         WHERE o.event_id = $1 FOR UPDATE`,
        [eventId]
      );
      const row = result.rows[0];
      if (!row) throw new Error("DATABASE_INCONSISTENT");
      if (row.status === "FAILED_FINAL") {
        await client.query("COMMIT");
        return;
      }
      if (!row.policy_id || !row.policy_version) throw new Error("DATABASE_INCONSISTENT");
      await client.query(
        `UPDATE verifier.use_records
         SET status = 'FAILED_FINAL', cached_result = $2::jsonb,
             failure_code = $3, completed_at = clock_timestamp()
         WHERE use_id = $1 AND status = 'ACCEPTED_PENDING_ACTION'`,
        [row.use_id, JSON.stringify({ failureCode }), failureCode]
      );
      await client.query(
        `UPDATE verifier.outbox_events
         SET state = 'DEAD_LETTER', lease_until = NULL, delivered_at = NULL, last_error_code = $2
         WHERE event_id = $1`,
        [eventId, failureCode]
      );
      await client.query(
        `INSERT INTO verifier.protocol_events (
           event_id, event_name, trace_id, demo_run_id, policy_id, policy_version,
           from_state, to_state, decision_code, usage_delta, action_delta
         ) VALUES ($1,'USE_FAILED_FINAL',$2,$3,$4,$5,
                   'ACCEPTED_PENDING_ACTION','FAILED_FINAL',$6,0,0)`,
        [
          randomUUID(),
          randomUUID(),
          row.demo_run_id,
          row.policy_id,
          row.policy_version,
          failureCode,
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const retryOutbox = async (eventId: string, errorCode: string, maxAttempts = 5) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<CompletionRow>(
        `SELECT o.use_id, u.demo_run_id, o.policy_id, o.policy_version,
                o.action_key, u.status
         FROM verifier.outbox_events AS o
         JOIN verifier.use_records AS u ON u.use_id = o.use_id
         WHERE o.event_id = $1 AND o.state = 'LEASED' FOR UPDATE`,
        [eventId]
      );
      const row = result.rows[0];
      if (!row) throw new Error("DATABASE_INCONSISTENT");
      const attempt = await client.query<{ attempt_count: number }>(
        "SELECT attempt_count FROM verifier.outbox_events WHERE event_id = $1",
        [eventId]
      );
      const attemptCount = attempt.rows[0]?.attempt_count;
      if (attemptCount === undefined) throw new Error("DATABASE_INCONSISTENT");
      if (attemptCount >= maxAttempts) {
        if (!row.policy_id || !row.policy_version) throw new Error("DATABASE_INCONSISTENT");
        await client.query(
          `UPDATE verifier.use_records
           SET status = 'FAILED_FINAL', cached_result = $2::jsonb,
               failure_code = 'ACTION_FAILED_FINAL', completed_at = clock_timestamp()
           WHERE use_id = $1 AND status = 'ACCEPTED_PENDING_ACTION'`,
          [row.use_id, JSON.stringify({ failureCode: "ACTION_FAILED_FINAL" })]
        );
        await client.query(
          `UPDATE verifier.outbox_events
           SET state = 'DEAD_LETTER', lease_until = NULL, delivered_at = NULL, last_error_code = $2
           WHERE event_id = $1`,
          [eventId, errorCode]
        );
        await client.query(
          `INSERT INTO verifier.protocol_events (
             event_id, event_name, trace_id, demo_run_id, policy_id, policy_version,
             from_state, to_state, decision_code, usage_delta, action_delta
           ) VALUES ($1,'USE_FAILED_FINAL',$2,$3,$4,$5,'ACCEPTED_PENDING_ACTION',
                     'FAILED_FINAL','ACTION_FAILED_FINAL',0,0)`,
          [randomUUID(), randomUUID(), row.demo_run_id, row.policy_id, row.policy_version]
        );
      } else {
        await client.query(
          `UPDATE verifier.outbox_events
           SET state = 'READY', lease_until = NULL, last_error_code = $2,
               next_attempt_at = clock_timestamp() +
                 ((LEAST(60, POWER(2, attempt_count)) * 1000) * INTERVAL '1 millisecond')
           WHERE event_id = $1`,
          [eventId, errorCode]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  return { ...lifecycle, claimOutboxBatch, completeOutboxSuccess, failOutbox, retryOutbox };
}
