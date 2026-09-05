import { createHash } from "node:crypto";
import {
  actionKeySchema,
  digestSchema,
  eventNameSchema,
  protocolEventSchema,
  timestampSchema,
  uuidSchema,
  type ProtocolEvent,
} from "@anonlimit/contracts";
import { type AcceptedUse, type Policy, type Receipt } from "@anonlimit/domain";
import type pg from "pg";

export interface ProtocolEventInput {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly event: ProtocolEvent["event"];
  readonly traceId: string;
  readonly demoRunId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly fromState?: ProtocolEvent["fromState"];
  readonly toState?: ProtocolEvent["toState"];
  readonly decisionCode?: ProtocolEvent["decisionCode"];
  readonly usageDelta: 0 | 1;
  readonly actionDelta: 0 | 1;
  readonly latencyMs?: number;
  readonly maskedUseRef?: ProtocolEvent["maskedUseRef"];
}

export interface EvidenceUseRecord {
  readonly acceptedUse: AcceptedUse;
  readonly actionKey: string;
  readonly maskedUseRef: string;
}

export interface VerifierEvidenceSnapshot {
  readonly demoRunId: string;
  readonly policy: Policy;
  readonly credentialIssuances: number | null;
  readonly uses: readonly EvidenceUseRecord[];
  readonly outboxUseIds: readonly string[];
  readonly events: readonly ProtocolEvent[];
  readonly privacy: {
    readonly storedHolderIdentities: number;
    readonly credentialWideIdentifiersStored: number;
  } | null;
}

interface PolicyRow {
  readonly policy_id: string;
  readonly version: number;
  readonly issuer_key_id: string;
  readonly verifier_audience: string;
  readonly max_uses: number;
  readonly quota_window_id: string;
  readonly not_before: Date | string;
  readonly expires_at: Date | string;
  readonly status: string;
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

interface EventRow {
  readonly sequence: number | string;
  readonly occurred_at: Date | string;
  readonly event_name: string;
  readonly trace_id: string;
  readonly demo_run_id: string;
  readonly policy_id: string;
  readonly policy_version: number;
  readonly from_state: string | null;
  readonly to_state: string | null;
  readonly decision_code: string | null;
  readonly usage_delta: number;
  readonly action_delta: number;
  readonly latency_ms: number | null;
  readonly masked_use_ref: string | null;
}

function iso(value: Date | string): string {
  const result = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (!timestampSchema.safeParse(result).success) throw new Error("DATABASE_INCONSISTENT");
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

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function receiptFrom(value: unknown, useId: string, actionKey: string): Receipt {
  if (
    !record(value) ||
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
    useId: uuidSchema.parse(row.use_id),
    demoRunId: uuidSchema.parse(row.demo_run_id),
    scopeHash: digestSchema.parse(row.scope_hash),
    nullifierKey: row.nullifier_key,
    operationId: uuidSchema.parse(row.operation_id),
    intentDigest: digestSchema.parse(row.intent_digest),
  } as const;
  switch (row.status) {
    case "ACCEPTED_PENDING_ACTION":
      return { ...identity, status: row.status };
    case "SUCCEEDED":
      return {
        ...identity,
        status: row.status,
        receipt: receiptFrom(
          row.cached_result,
          identity.useId,
          actionKeySchema.parse(row.action_key)
        ),
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

function maskedUseRef(useId: string): string {
  return `use_${createHash("sha256").update(useId, "utf8").digest("hex").slice(0, 12)}`;
}

function eventFromRow(row: EventRow): ProtocolEvent {
  const sequence = typeof row.sequence === "string" ? Number(row.sequence) : row.sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("DATABASE_INCONSISTENT");
  const base = {
    sequence,
    occurredAt: iso(row.occurred_at),
    event: eventNameSchema.parse(row.event_name),
    traceId: uuidSchema.parse(row.trace_id),
    demoRunId: uuidSchema.parse(row.demo_run_id),
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    usageDelta: row.usage_delta,
    actionDelta: row.action_delta,
  } as const;
  return protocolEventSchema.parse({
    ...base,
    ...(row.from_state === null ? {} : { fromState: row.from_state }),
    ...(row.to_state === null ? {} : { toState: row.to_state }),
    ...(row.decision_code === null ? {} : { decisionCode: row.decision_code }),
    ...(row.latency_ms === null ? {} : { latencyMs: row.latency_ms }),
    ...(row.masked_use_ref === null ? {} : { maskedUseRef: row.masked_use_ref }),
  });
}

const POLICY_SELECT = `
  SELECT policy_id, version, issuer_key_id, verifier_audience, max_uses,
         quota_window_id, not_before, expires_at, status
  FROM verifier.quota_policies
`;

const USE_SELECT = `
  SELECT use_id, demo_run_id, scope_hash, nullifier_key, operation_id,
         intent_digest, status, action_key, cached_result, failure_code
  FROM verifier.use_records
`;

const EVENT_SELECT = `
  SELECT sequence, occurred_at, event_name, trace_id, demo_run_id,
         policy_id, policy_version, from_state, to_state, decision_code,
         usage_delta, action_delta, latency_ms, masked_use_ref
  FROM verifier.evidence_events
`;

function validateEvent(input: ProtocolEventInput): void {
  uuidSchema.parse(input.eventId);
  protocolEventSchema.parse({
    sequence: 1,
    occurredAt: input.occurredAt,
    event: input.event,
    traceId: input.traceId,
    demoRunId: input.demoRunId,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    ...(input.fromState === undefined ? {} : { fromState: input.fromState }),
    ...(input.toState === undefined ? {} : { toState: input.toState }),
    ...(input.decisionCode === undefined ? {} : { decisionCode: input.decisionCode }),
    usageDelta: input.usageDelta,
    actionDelta: input.actionDelta,
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    ...(input.maskedUseRef === undefined ? {} : { maskedUseRef: input.maskedUseRef }),
  });
}

export function createVerifierEvidenceQueries(pool: pg.Pool) {
  const getActiveRunId = async (): Promise<string | null> => {
    const result = await pool.query<{ demo_run_id: string }>(
      "SELECT demo_run_id FROM verifier.demo_runs WHERE status = 'ACTIVE'"
    );
    if (result.rows.length > 1) throw new Error("DATABASE_INCONSISTENT");
    return result.rows[0]?.demo_run_id ?? null;
  };

  const getProtocolEvents = async (after = 0, limit = 100): Promise<readonly ProtocolEvent[]> => {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1)
      throw new Error("EVENT_CURSOR_INVALID");
    const demoRunId = await getActiveRunId();
    if (!demoRunId) return [];
    const result = await pool.query<EventRow>(
      `${EVENT_SELECT}
       WHERE demo_run_id = $1 AND sequence > $2
       ORDER BY sequence
       LIMIT $3`,
      [demoRunId, after, Math.min(limit, 500)]
    );
    return result.rows.map(eventFromRow);
  };

  const appendProtocolEvent = async (input: ProtocolEventInput): Promise<void> => {
    validateEvent(input);
    await pool.query(
      `INSERT INTO verifier.protocol_events (
         event_id, occurred_at, event_name, trace_id, demo_run_id,
         policy_id, policy_version, from_state, to_state, decision_code,
         usage_delta, action_delta, latency_ms, masked_use_ref
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.eventId,
        input.occurredAt,
        input.event,
        input.traceId,
        input.demoRunId,
        input.policyId,
        input.policyVersion,
        input.fromState ?? null,
        input.toState ?? null,
        input.decisionCode ?? null,
        input.usageDelta,
        input.actionDelta,
        input.latencyMs ?? null,
        input.maskedUseRef ?? null,
      ]
    );
  };

  const getEvidenceSnapshot = async (): Promise<VerifierEvidenceSnapshot | null> => {
    const runResult = await pool.query<{ demo_run_id: string }>(
      "SELECT demo_run_id FROM verifier.demo_runs WHERE status = 'ACTIVE'"
    );
    if (runResult.rows.length !== 1) {
      if (runResult.rows.length === 0) return null;
      throw new Error("DATABASE_INCONSISTENT");
    }
    const demoRunId = uuidSchema.parse(runResult.rows[0]?.demo_run_id);
    const policyResult = await pool.query<PolicyRow>(
      `${POLICY_SELECT}
       WHERE status = 'ACTIVE' AND now() >= not_before AND now() < expires_at
       ORDER BY version DESC LIMIT 1`
    );
    const policyRow = policyResult.rows[0];
    if (!policyRow) throw new Error("DATABASE_NOT_READY");
    const policy = policyFromRow(policyRow);
    const [useResult, outboxResult, eventResult, issuanceResult, privacyResult] = await Promise.all(
      [
        pool.query<UseRow>(`${USE_SELECT} WHERE demo_run_id = $1 ORDER BY use_id`, [demoRunId]),
        pool.query<{ use_id: string }>(
          `SELECT o.use_id
         FROM verifier.outbox_events AS o
         JOIN verifier.use_records AS u ON u.use_id = o.use_id
         WHERE u.demo_run_id = $1
         ORDER BY o.created_at, o.event_id`,
          [demoRunId]
        ),
        pool.query<EventRow>(`${EVENT_SELECT} WHERE demo_run_id = $1 ORDER BY sequence`, [
          demoRunId,
        ]),
        pool.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM verifier.protocol_events WHERE demo_run_id = $1 AND event_name = 'CREDENTIAL_ISSUED'",
          [demoRunId]
        ),
        pool.query<{ holder_identities: number; credential_identifiers: number }>(
          `SELECT
           count(*) FILTER (WHERE column_name ~* '(holder|user|subject|identity|email|account)')::integer AS holder_identities,
           count(*) FILTER (WHERE column_name ~* '(credential(_|)id|credential(_|)serial|serial(_|)number)')::integer AS credential_identifiers
         FROM information_schema.columns
         WHERE table_schema = 'verifier'
           AND table_name IN ('demo_runs','quota_policies','verification_challenges','use_records','outbox_events','protocol_events','demo_faults')`
        ),
      ]
    );
    const uses = useResult.rows.map((row) => ({
      acceptedUse: acceptedUseFromRow(row),
      actionKey: actionKeySchema.parse(row.action_key),
      maskedUseRef: maskedUseRef(uuidSchema.parse(row.use_id)),
    }));
    const privacy = privacyResult.rows[0];
    if (!privacy) throw new Error("DATABASE_INCONSISTENT");
    return {
      demoRunId,
      policy,
      credentialIssuances: issuanceResult.rows[0]?.count ?? null,
      uses,
      outboxUseIds: outboxResult.rows.map((row) => uuidSchema.parse(row.use_id)),
      events: eventResult.rows.map(eventFromRow),
      privacy: {
        storedHolderIdentities: privacy.holder_identities,
        credentialWideIdentifiersStored: privacy.credential_identifiers,
      },
    };
  };

  return { appendProtocolEvent, getEvidenceSnapshot, getProtocolEvents };
}
