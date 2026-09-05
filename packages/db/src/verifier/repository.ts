import {
  assertPolicyFresh,
  type AcceptedUse,
  type Action,
  type Policy,
  type Receipt,
} from "@anonlimit/domain";
import { createConnectionLifecycle, createPool } from "../connection.js";
import {
  AcceptancePreconditionError,
  AcceptanceRaceLostError,
  acceptanceUniquenessError,
} from "../transaction.js";

export interface ActiveDemoRun {
  readonly demoRunId: string;
  readonly status: "ACTIVE";
  readonly startedAt: string;
}

export interface StoredChallenge {
  readonly challengeId: string;
  readonly demoRunId: string;
  readonly nonceHash: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly operationId: string;
  readonly intentDigest: string;
  readonly scopeHash: string;
  readonly policyDigest: string;
  readonly expiresAt: string;
  readonly state: "ISSUED" | "CONSUMED" | "EXPIRED";
  readonly useId: string | null;
  readonly createdAt: string;
}

export interface NewChallenge {
  readonly challengeId: string;
  readonly demoRunId: string;
  readonly nonceHash: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly operationId: string;
  readonly intentDigest: string;
  readonly scopeHash: string;
  readonly policyDigest: string;
  readonly expiresAt: string;
}

export interface AcceptedUseLookup {
  readonly demoRunId: string;
  readonly scopeHash: string;
  readonly nullifierKey: string;
  readonly operationId: string;
}

export interface ExistingAcceptedUses {
  readonly byNullifier: AcceptedUse | null;
  readonly byOperation: AcceptedUse | null;
}

export interface AcceptanceInput {
  readonly useId: string;
  readonly outboxEventId: string;
  readonly protocolEventId: string;
  readonly traceId: string;
  readonly demoRunId: string;
  readonly policy: Policy;
  readonly policyDigest: string;
  readonly challenge: StoredChallenge;
  readonly nullifierKey: string;
  readonly actionKey: string;
  readonly payloadDigest: string;
  readonly action: Action;
  readonly maskedUseRef: string;
}

interface PolicyRow {
  readonly policy_id: string;
  readonly version: number;
  readonly issuer_key_id: string;
  readonly verifier_audience: string;
  readonly max_uses: number;
  readonly quota_window_id: string;
  readonly policy_digest: string;
  readonly not_before: Date | string;
  readonly expires_at: Date | string;
  readonly status: string;
}

interface ChallengeRow {
  readonly challenge_id: string;
  readonly demo_run_id: string;
  readonly nonce_hash: string;
  readonly policy_id: string;
  readonly policy_version: number;
  readonly operation_id: string;
  readonly intent_digest: string;
  readonly scope_hash: string;
  readonly policy_digest: string;
  readonly expires_at: Date | string;
  readonly state: string;
  readonly use_id: string | null;
  readonly created_at: Date | string;
}

interface UseRow {
  readonly use_id: string;
  readonly demo_run_id: string;
  readonly scope_hash: string;
  readonly nullifier_key: string;
  readonly operation_id: string;
  readonly intent_digest: string;
  readonly status: string;
  readonly action_key: string;
  readonly cached_result: unknown;
  readonly failure_code: string | null;
}

interface ClockRow {
  readonly current_time: Date | string;
}

interface ReadinessRow {
  readonly active_runs: number;
  readonly policy_loaded: boolean;
}

function iso(value: Date | string): string {
  const result = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (result === "Invalid Date") throw new Error("DATABASE_INCONSISTENT");
  return result;
}

function policyFromRow(row: PolicyRow): Policy {
  if (row.status !== "ACTIVE" && row.status !== "DISABLED")
    throw new Error("DATABASE_INCONSISTENT");
  return {
    id: row.policy_id,
    version: row.version,
    issuerKeyId: row.issuer_key_id,
    audience: row.verifier_audience,
    maxUses: row.max_uses,
    quotaWindowId: row.quota_window_id,
    status: row.status,
    validFrom: iso(row.not_before),
    validUntil: iso(row.expires_at),
  };
}

function challengeFromRow(row: ChallengeRow): StoredChallenge {
  if (!["ISSUED", "CONSUMED", "EXPIRED"].includes(row.state))
    throw new Error("DATABASE_INCONSISTENT");
  return {
    challengeId: row.challenge_id,
    demoRunId: row.demo_run_id,
    nonceHash: row.nonce_hash,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    operationId: row.operation_id,
    intentDigest: row.intent_digest,
    scopeHash: row.scope_hash,
    policyDigest: row.policy_digest,
    expiresAt: iso(row.expires_at),
    state: row.state as StoredChallenge["state"],
    useId: row.use_id,
    createdAt: iso(row.created_at),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function receiptFrom(value: unknown, useId: string, actionKey: string): Receipt {
  if (
    !isRecord(value) ||
    typeof value.receiptId !== "string" ||
    value.useId !== useId ||
    value.actionKey !== actionKey ||
    value.status !== "COMMITTED" ||
    typeof value.committedAt !== "string"
  )
    throw new Error("DATABASE_INCONSISTENT");
  return {
    receiptId: value.receiptId,
    useId,
    actionKey,
    status: "COMMITTED",
    committedAt: value.committedAt,
  };
}

function acceptedUseFromRow(row: UseRow): AcceptedUse {
  const identity = {
    useId: row.use_id,
    demoRunId: row.demo_run_id,
    scopeHash: row.scope_hash,
    nullifierKey: row.nullifier_key,
    operationId: row.operation_id,
    intentDigest: row.intent_digest,
  };
  switch (row.status) {
    case "ACCEPTED_PENDING_ACTION":
      return { ...identity, status: row.status };
    case "SUCCEEDED":
      return {
        ...identity,
        status: row.status,
        receipt: receiptFrom(row.cached_result, row.use_id, row.action_key),
      };
    case "FAILED_FINAL":
      if (
        row.failure_code !== "ACTION_FAILED_FINAL" &&
        row.failure_code !== "ACTION_INTEGRITY_CONFLICT"
      )
        throw new Error("DATABASE_INCONSISTENT");
      return { ...identity, status: row.status, failureCode: row.failure_code };
    default:
      throw new Error("DATABASE_INCONSISTENT");
  }
}

const POLICY_SELECT = `
  SELECT policy_id, version, issuer_key_id, verifier_audience, max_uses,
         quota_window_id, policy_digest, not_before, expires_at, status
  FROM verifier.quota_policies
`;

const CHALLENGE_SELECT = `
  SELECT challenge_id, demo_run_id, nonce_hash, policy_id, policy_version,
         operation_id, intent_digest, scope_hash, policy_digest, expires_at,
         state, use_id, created_at
  FROM verifier.verification_challenges
`;

const USE_SELECT = `
  SELECT use_id, demo_run_id, scope_hash, nullifier_key, operation_id,
         intent_digest, status, action_key, cached_result, failure_code
  FROM verifier.use_records
`;

function samePolicy(left: Policy, right: Policy): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.issuerKeyId === right.issuerKeyId &&
    left.audience === right.audience &&
    left.maxUses === right.maxUses &&
    left.quotaWindowId === right.quotaWindowId &&
    left.status === right.status &&
    left.validFrom === right.validFrom &&
    left.validUntil === right.validUntil
  );
}

function sameChallenge(left: StoredChallenge, right: StoredChallenge): boolean {
  return (
    left.challengeId === right.challengeId &&
    left.demoRunId === right.demoRunId &&
    left.nonceHash === right.nonceHash &&
    left.policyId === right.policyId &&
    left.policyVersion === right.policyVersion &&
    left.operationId === right.operationId &&
    left.intentDigest === right.intentDigest &&
    left.scopeHash === right.scopeHash &&
    left.policyDigest === right.policyDigest &&
    left.expiresAt === right.expiresAt
  );
}

export interface VerifierDatabase {
  check(): Promise<void>;
  close(): Promise<void>;
  getPolicy(policyId: string, version: number): Promise<Policy | null>;
  getActiveRun(): Promise<ActiveDemoRun | null>;
  getActiveDemoRun(): Promise<ActiveDemoRun | null>;
  createChallenge(input: NewChallenge): Promise<StoredChallenge>;
  insertChallenge(input: NewChallenge): Promise<StoredChallenge>;
  getChallenge(challengeId: string): Promise<StoredChallenge | null>;
  findAcceptedUses(input: AcceptedUseLookup): Promise<ExistingAcceptedUses>;
  acceptPresentation(input: AcceptanceInput): Promise<AcceptedUse>;
}

export function createVerifierDatabase(connectionString: string): VerifierDatabase {
  const pool = createPool(connectionString);
  const lifecycle = createConnectionLifecycle(pool);

  const check = async (): Promise<void> => {
    await lifecycle.check();
    const result = await pool.query<ReadinessRow>(`
      WITH readiness_clock AS MATERIALIZED (
        SELECT clock_timestamp() AS checked_at
      )
      SELECT
        (SELECT count(*)::integer
         FROM verifier.demo_runs
         WHERE status = 'ACTIVE') AS active_runs,
        EXISTS (
          SELECT 1
          FROM verifier.quota_policies
          CROSS JOIN readiness_clock
          WHERE status = 'ACTIVE'
            AND not_before <= readiness_clock.checked_at
            AND expires_at > readiness_clock.checked_at
        ) AS policy_loaded
    `);
    const readiness = result.rows[0];
    if (!readiness || readiness.active_runs !== 1 || !readiness.policy_loaded)
      throw new Error("DATABASE_NOT_READY");
  };

  const getPolicy = async (policyId: string, version: number): Promise<Policy | null> => {
    const result = await pool.query<PolicyRow>(
      `${POLICY_SELECT} WHERE policy_id = $1 AND version = $2`,
      [policyId, version]
    );
    const row = result.rows[0];
    return row ? policyFromRow(row) : null;
  };

  const getActiveRun = async (): Promise<ActiveDemoRun | null> => {
    const result = await pool.query<{
      demo_run_id: string;
      status: string;
      started_at: Date | string;
    }>("SELECT demo_run_id, status, started_at FROM verifier.demo_runs WHERE status = 'ACTIVE'");
    const row = result.rows[0];
    if (!row) return null;
    if (row.status !== "ACTIVE" || result.rows.length !== 1)
      throw new Error("DATABASE_INCONSISTENT");
    return { demoRunId: row.demo_run_id, status: "ACTIVE", startedAt: iso(row.started_at) };
  };

  const createChallenge = async (input: NewChallenge): Promise<StoredChallenge> => {
    const result = await pool.query<ChallengeRow>(
      `INSERT INTO verifier.verification_challenges (
         challenge_id, demo_run_id, nonce_hash, policy_id, policy_version,
         operation_id, intent_digest, scope_hash, policy_digest, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING challenge_id, demo_run_id, nonce_hash, policy_id, policy_version,
                 operation_id, intent_digest, scope_hash, policy_digest, expires_at,
                 state, use_id, created_at`,
      [
        input.challengeId,
        input.demoRunId,
        input.nonceHash,
        input.policyId,
        input.policyVersion,
        input.operationId,
        input.intentDigest,
        input.scopeHash,
        input.policyDigest,
        input.expiresAt,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("DATABASE_INCONSISTENT");
    return challengeFromRow(row);
  };

  const getChallenge = async (challengeId: string): Promise<StoredChallenge | null> => {
    const result = await pool.query<ChallengeRow>(`${CHALLENGE_SELECT} WHERE challenge_id = $1`, [
      challengeId,
    ]);
    const row = result.rows[0];
    return row ? challengeFromRow(row) : null;
  };

  const findAcceptedUses = async (input: AcceptedUseLookup): Promise<ExistingAcceptedUses> => {
    const result = await pool.query<UseRow>(
      `${USE_SELECT}
       WHERE demo_run_id = $1 AND scope_hash = $2
         AND (nullifier_key = $3 OR operation_id = $4)`,
      [input.demoRunId, input.scopeHash, input.nullifierKey, input.operationId]
    );
    let byNullifier: AcceptedUse | null = null;
    let byOperation: AcceptedUse | null = null;
    for (const row of result.rows) {
      const record = acceptedUseFromRow(row);
      if (row.nullifier_key === input.nullifierKey) byNullifier = record;
      if (row.operation_id === input.operationId) byOperation = record;
    }
    return { byNullifier, byOperation };
  };

  const acceptPresentation = async (input: AcceptanceInput): Promise<AcceptedUse> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const runResult = await client.query<{ status: string }>(
          "SELECT status FROM verifier.demo_runs WHERE demo_run_id = $1 FOR UPDATE",
          [input.demoRunId]
        );
        if (runResult.rows[0]?.status !== "ACTIVE")
          throw new AcceptancePreconditionError("POLICY_REJECTED");

        const policyResult = await client.query<PolicyRow>(
          `${POLICY_SELECT} WHERE policy_id = $1 AND version = $2 FOR UPDATE`,
          [input.policy.id, input.policy.version]
        );
        const policyRow = policyResult.rows[0];
        if (!policyRow || policyRow.policy_digest !== input.policyDigest)
          throw new AcceptancePreconditionError("POLICY_REJECTED");
        const authoritativePolicy = policyFromRow(policyRow);
        if (!samePolicy(authoritativePolicy, input.policy))
          throw new AcceptancePreconditionError("POLICY_REJECTED");

        const challengeResult = await client.query<ChallengeRow>(
          `${CHALLENGE_SELECT} WHERE challenge_id = $1 FOR UPDATE`,
          [input.challenge.challengeId]
        );
        const challengeRow = challengeResult.rows[0];
        if (!challengeRow) throw new AcceptancePreconditionError("CHALLENGE_REJECTED");
        const authoritativeChallenge = challengeFromRow(challengeRow);
        if (!sameChallenge(authoritativeChallenge, input.challenge))
          throw new AcceptancePreconditionError("CHALLENGE_REJECTED");
        if (authoritativeChallenge.state === "CONSUMED") throw new AcceptanceRaceLostError();
        if (authoritativeChallenge.state === "EXPIRED")
          throw new AcceptancePreconditionError("CHALLENGE_EXPIRED");

        // Read the wall clock only after all authoritative rows are locked. A request timestamp
        // captured before proof verification or a lock wait cannot extend policy/challenge life.
        const clockResult = await client.query<ClockRow>(
          "SELECT clock_timestamp() AS current_time"
        );
        const clockRow = clockResult.rows[0];
        if (!clockRow) throw new Error("DATABASE_INCONSISTENT");
        const currentTime = Date.parse(iso(clockRow.current_time));
        try {
          assertPolicyFresh(authoritativePolicy, currentTime);
        } catch {
          throw new AcceptancePreconditionError("POLICY_REJECTED");
        }
        if (currentTime >= Date.parse(authoritativeChallenge.expiresAt))
          throw new AcceptancePreconditionError("CHALLENGE_EXPIRED");

        await client.query(
          `INSERT INTO verifier.use_records (
             use_id, demo_run_id, challenge_id, scope_hash, nullifier_key,
             operation_id, intent_digest, status, action_key
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACCEPTED_PENDING_ACTION',$8)`,
          [
            input.useId,
            input.demoRunId,
            input.challenge.challengeId,
            input.challenge.scopeHash,
            input.nullifierKey,
            input.challenge.operationId,
            input.challenge.intentDigest,
            input.actionKey,
          ]
        );

        const consumed = await client.query(
          `UPDATE verifier.verification_challenges
           SET state = 'CONSUMED', use_id = $2
           WHERE challenge_id = $1 AND state = 'ISSUED'`,
          [input.challenge.challengeId, input.useId]
        );
        if (consumed.rowCount !== 1) throw new AcceptancePreconditionError("CHALLENGE_REJECTED");

        await client.query(
          `INSERT INTO verifier.outbox_events (
             event_id, use_id, event_type, action_key, payload_digest, safe_payload,
             state, attempt_count
           ) VALUES ($1,$2,'COMMIT_DEMO_ACTION',$3,$4,$5::jsonb,'READY',0)`,
          [
            input.outboxEventId,
            input.useId,
            input.actionKey,
            input.payloadDigest,
            JSON.stringify(input.action),
          ]
        );

        await client.query(
          `INSERT INTO verifier.protocol_events (
             event_id, event_name, trace_id, demo_run_id,
             policy_id, policy_version, from_state, to_state, decision_code,
             usage_delta, action_delta, masked_use_ref
           ) VALUES ($1,'USE_ACCEPTED',$2,$3,$4,$5,'UNSEEN',
                     'ACCEPTED_PENDING_ACTION','ACCEPTED_PENDING_ACTION',1,0,$6)`,
          [
            input.protocolEventId,
            input.traceId,
            input.demoRunId,
            input.policy.id,
            input.policy.version,
            input.maskedUseRef,
          ]
        );

        await client.query("COMMIT");
        return {
          useId: input.useId,
          demoRunId: input.demoRunId,
          scopeHash: input.challenge.scopeHash,
          nullifierKey: input.nullifierKey,
          operationId: input.challenge.operationId,
          intentDigest: input.challenge.intentDigest,
          status: "ACCEPTED_PENDING_ACTION",
        };
      } catch (error) {
        await client.query("ROLLBACK");
        const conflict = acceptanceUniquenessError(error);
        if (conflict) throw conflict;
        throw error;
      }
    } finally {
      client.release();
    }
  };

  return {
    ...lifecycle,
    check,
    getPolicy,
    getActiveRun,
    getActiveDemoRun: getActiveRun,
    createChallenge,
    insertChallenge: createChallenge,
    getChallenge,
    findAcceptedUses,
    acceptPresentation,
  };
}
