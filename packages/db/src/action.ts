import { randomUUID } from "node:crypto";
import {
  internalDemoResetRequestSchema,
  internalDemoResetResponseSchema,
  internalActionRequestSchema,
  internalActionResponseSchema,
  receiptSchema,
  type InternalActionRequest,
  type InternalActionResponse,
  type InternalDemoResetRequest,
  type InternalDemoResetResponse,
} from "@anonlimit/contracts";
import { createConnectionLifecycle, createPool } from "./connection.js";

export class ActionIntegrityConflictError extends Error {
  constructor() {
    super("ACTION_INTEGRITY_CONFLICT");
    this.name = "ActionIntegrityConflictError";
  }
}

export class ActionDatabaseInconsistentError extends Error {
  constructor() {
    super("DATABASE_INCONSISTENT");
    this.name = "ActionDatabaseInconsistentError";
  }
}

export class ActionDemoRunResetError extends Error {
  constructor() {
    super("DEMO_RUN_RESET");
    this.name = "ActionDemoRunResetError";
  }
}

interface ActionResultRow {
  readonly action_key: string;
  readonly demo_run_id: string;
  readonly payload_digest: string;
  readonly receipt: unknown;
}

interface ResetDemoRunRow {
  readonly demo_run_id: string;
  readonly reset_at: Date | string;
}

export interface ActionDatabase {
  check(): Promise<void>;
  close(): Promise<void>;
  commitAction(request: InternalActionRequest): Promise<InternalActionResponse>;
  resetDemoRun(request: InternalDemoResetRequest): Promise<InternalDemoResetResponse>;
  getEvidence?(): Promise<{
    readonly externalActions: number;
    readonly receipts: readonly ReturnType<typeof receiptSchema.parse>[];
  }>;
}

function existingResponse(
  row: ActionResultRow,
  request: InternalActionRequest
): InternalActionResponse {
  if (row.payload_digest !== request.payloadDigest) throw new ActionIntegrityConflictError();
  if (row.demo_run_id !== request.demoRunId) throw new ActionIntegrityConflictError();
  const receipt = receiptSchema.safeParse(row.receipt);
  if (!receipt.success || receipt.data.actionKey !== request.actionKey)
    throw new ActionDatabaseInconsistentError();
  return internalActionResponseSchema.parse({
    receipt: receipt.data,
    replayed: true,
    actionDelta: 0,
  });
}

export function createActionDatabase(connectionString: string): ActionDatabase {
  const pool = createPool(connectionString);
  const lifecycle = createConnectionLifecycle(pool);

  const commitAction = async (
    rawRequest: InternalActionRequest
  ): Promise<InternalActionResponse> => {
    const request = internalActionRequestSchema.parse(rawRequest);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 170026::bigint))",
        [request.demoRunId]
      );
      const resetRun = await client.query(
        "SELECT 1 FROM action_sim.reset_demo_runs WHERE demo_run_id = $1",
        [request.demoRunId]
      );
      if (resetRun.rowCount !== 0) throw new ActionDemoRunResetError();
      const existing = await client.query<ActionResultRow>(
        `SELECT action_key, demo_run_id, payload_digest, receipt
         FROM action_sim.action_results WHERE action_key = $1 FOR UPDATE`,
        [request.actionKey]
      );
      if (existing.rows[0]) {
        const response = existingResponse(existing.rows[0], request);
        await client.query("COMMIT");
        return response;
      }
      const receipt = receiptSchema.parse({
        receiptId: randomUUID(),
        useId: request.useId,
        actionKey: request.actionKey,
        status: "COMMITTED",
        committedAt: new Date().toISOString(),
      });
      const inserted = await client.query<ActionResultRow>(
        `INSERT INTO action_sim.action_results
           (action_key, demo_run_id, payload_digest, receipt, committed_at)
         VALUES ($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT (action_key) DO NOTHING
         RETURNING action_key, demo_run_id, payload_digest, receipt`,
        [
          request.actionKey,
          request.demoRunId,
          request.payloadDigest,
          JSON.stringify(receipt),
          receipt.committedAt,
        ]
      );
      if (inserted.rowCount !== 1) {
        const raced = await client.query<ActionResultRow>(
          `SELECT action_key, demo_run_id, payload_digest, receipt
           FROM action_sim.action_results WHERE action_key = $1 FOR UPDATE`,
          [request.actionKey]
        );
        if (!raced.rows[0]) throw new ActionDatabaseInconsistentError();
        const response = existingResponse(raced.rows[0], request);
        await client.query("COMMIT");
        return response;
      }
      await client.query("COMMIT");
      return internalActionResponseSchema.parse({ receipt, replayed: false, actionDelta: 1 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const resetDemoRun = async (
    rawRequest: InternalDemoResetRequest
  ): Promise<InternalDemoResetResponse> => {
    const request = internalDemoResetRequestSchema.parse(rawRequest);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 170026::bigint))",
        [request.demoRunId]
      );
      await client.query(
        `INSERT INTO action_sim.reset_demo_runs (demo_run_id)
         VALUES ($1)
         ON CONFLICT (demo_run_id) DO NOTHING`,
        [request.demoRunId]
      );
      await client.query("DELETE FROM action_sim.action_results WHERE demo_run_id = $1", [
        request.demoRunId,
      ]);
      const result = await client.query<ResetDemoRunRow>(
        `SELECT demo_run_id, reset_at
         FROM action_sim.reset_demo_runs
         WHERE demo_run_id = $1`,
        [request.demoRunId]
      );
      const row = result.rows[0];
      if (!row) throw new ActionDatabaseInconsistentError();
      const resetAt =
        row.reset_at instanceof Date
          ? row.reset_at.toISOString()
          : new Date(row.reset_at).toISOString();
      const response = internalDemoResetResponseSchema.parse({
        demoRunId: row.demo_run_id,
        resetAt,
      });
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const getEvidence = async () => {
    const result = await pool.query<ActionResultRow>(
      `SELECT action_key, demo_run_id, payload_digest, receipt
       FROM action_sim.action_results ORDER BY committed_at`
    );
    const receipts = result.rows.map((row) => {
      const parsed = receiptSchema.safeParse(row.receipt);
      if (!parsed.success) throw new ActionDatabaseInconsistentError();
      return parsed.data;
    });
    return { externalActions: receipts.length, receipts };
  };

  return { ...lifecycle, commitAction, resetDemoRun, getEvidence };
}
