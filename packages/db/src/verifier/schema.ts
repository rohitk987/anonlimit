import { sql } from "drizzle-orm/sql";
import { bigint } from "drizzle-orm/pg-core/columns/bigint";
import { boolean } from "drizzle-orm/pg-core/columns/boolean";
import { integer } from "drizzle-orm/pg-core/columns/integer";
import { jsonb } from "drizzle-orm/pg-core/columns/jsonb";
import { text } from "drizzle-orm/pg-core/columns/text";
import { timestamp } from "drizzle-orm/pg-core/columns/timestamp";
import { uuid } from "drizzle-orm/pg-core/columns/uuid";
import { varchar } from "drizzle-orm/pg-core/columns/varchar";
import { check } from "drizzle-orm/pg-core/checks";
import type { AnyPgColumn } from "drizzle-orm/pg-core/columns/common";
import { foreignKey } from "drizzle-orm/pg-core/foreign-keys";
import { index, uniqueIndex } from "drizzle-orm/pg-core/indexes";
import { primaryKey } from "drizzle-orm/pg-core/primary-keys";
import { pgSchema } from "drizzle-orm/pg-core/schema";
import { unique } from "drizzle-orm/pg-core/unique-constraint";

export const verifierSchema = pgSchema("verifier");

export const demoRuns = verifierSchema.table(
  "demo_runs",
  {
    demoRunId: uuid("demo_run_id").primaryKey(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    check("ck_demo_runs_status", sql`${table.status} IN ('ACTIVE', 'CLOSED')`),
    check(
      "ck_demo_runs_closed_at",
      sql`(
        (${table.status} = 'ACTIVE' AND ${table.closedAt} IS NULL)
        OR (${table.status} = 'CLOSED' AND ${table.closedAt} IS NOT NULL)
      )`
    ),
    uniqueIndex("uq_demo_runs_single_active")
      .on(table.status)
      .where(sql`${table.status} = 'ACTIVE'`),
  ]
);

export const quotaPolicies = verifierSchema.table(
  "quota_policies",
  {
    policyId: varchar("policy_id", { length: 128 }).notNull(),
    version: integer("version").notNull(),
    issuerKeyId: varchar("issuer_key_id", { length: 128 }).notNull(),
    verifierAudience: varchar("verifier_audience", { length: 128 }).notNull(),
    maxUses: integer("max_uses").notNull(),
    quotaWindowId: varchar("quota_window_id", { length: 128 }).notNull(),
    policyDigest: varchar("policy_digest", { length: 71 }).notNull(),
    notBefore: timestamp("not_before", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ name: "pk_quota_policies", columns: [table.policyId, table.version] }),
    unique("uq_quota_policies_digest").on(table.policyDigest),
    check("ck_quota_policies_version", sql`${table.version} BETWEEN 1 AND 2147483647`),
    check("ck_quota_policies_max_uses", sql`${table.maxUses} BETWEEN 1 AND 100`),
    check("ck_quota_policies_digest", sql`${table.policyDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    check("ck_quota_policies_status", sql`${table.status} IN ('ACTIVE', 'DISABLED')`),
    check("ck_quota_policies_validity", sql`${table.notBefore} < ${table.expiresAt}`),
  ]
);

// The migration has a deliberate verification_challenges <-> use_records cycle.
// An explicit return type keeps TypeScript from inferring the two table declarations recursively.
function referencedUseId(): AnyPgColumn {
  return useRecords.useId;
}

export const verificationChallenges = verifierSchema.table(
  "verification_challenges",
  {
    challengeId: uuid("challenge_id").primaryKey(),
    demoRunId: uuid("demo_run_id").notNull(),
    nonceHash: varchar("nonce_hash", { length: 71 }).notNull(),
    policyId: varchar("policy_id", { length: 128 }).notNull(),
    policyVersion: integer("policy_version").notNull(),
    operationId: uuid("operation_id").notNull(),
    intentDigest: varchar("intent_digest", { length: 71 }).notNull(),
    scopeHash: varchar("scope_hash", { length: 71 }).notNull(),
    policyDigest: varchar("policy_digest", { length: 71 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    state: text("state").default("ISSUED").notNull(),
    useId: uuid("use_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_verification_challenges_run",
      columns: [table.demoRunId],
      foreignColumns: [demoRuns.demoRunId],
    }),
    foreignKey({
      name: "fk_verification_challenges_policy",
      columns: [table.policyId, table.policyVersion],
      foreignColumns: [quotaPolicies.policyId, quotaPolicies.version],
    }),
    foreignKey({
      name: "fk_verification_challenges_use",
      columns: [table.useId],
      foreignColumns: [referencedUseId()],
    }),
    unique("uq_verification_challenges_nonce_hash").on(table.nonceHash),
    index("ix_verification_challenges_expiry").on(table.state, table.expiresAt),
    index("ix_verification_challenges_operation").on(table.demoRunId, table.operationId),
    check(
      "ck_verification_challenges_nonce_hash",
      sql`${table.nonceHash} ~ '^sha256:[a-f0-9]{64}$'`
    ),
    check(
      "ck_verification_challenges_intent_digest",
      sql`${table.intentDigest} ~ '^sha256:[a-f0-9]{64}$'`
    ),
    check(
      "ck_verification_challenges_scope_hash",
      sql`${table.scopeHash} ~ '^sha256:[a-f0-9]{64}$'`
    ),
    check(
      "ck_verification_challenges_policy_digest",
      sql`${table.policyDigest} ~ '^sha256:[a-f0-9]{64}$'`
    ),
    check(
      "ck_verification_challenges_state",
      sql`${table.state} IN ('ISSUED', 'CONSUMED', 'EXPIRED')`
    ),
    check(
      "ck_verification_challenges_use_state",
      sql`(
        (${table.state} = 'CONSUMED' AND ${table.useId} IS NOT NULL)
        OR (${table.state} IN ('ISSUED', 'EXPIRED') AND ${table.useId} IS NULL)
      )`
    ),
    check("ck_verification_challenges_expiry", sql`${table.createdAt} < ${table.expiresAt}`),
  ]
);

export type CachedUseResult = Readonly<Record<string, unknown>>;

export const useRecords = verifierSchema.table(
  "use_records",
  {
    useId: uuid("use_id").primaryKey(),
    demoRunId: uuid("demo_run_id").notNull(),
    challengeId: uuid("challenge_id").notNull(),
    scopeHash: varchar("scope_hash", { length: 71 }).notNull(),
    nullifierKey: varchar("nullifier_key", { length: 76 }).notNull(),
    operationId: uuid("operation_id").notNull(),
    intentDigest: varchar("intent_digest", { length: 71 }).notNull(),
    status: text("status").notNull(),
    actionKey: varchar("action_key", { length: 76 }).notNull(),
    cachedResult: jsonb("cached_result").$type<CachedUseResult>(),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      name: "fk_use_records_run",
      columns: [table.demoRunId],
      foreignColumns: [demoRuns.demoRunId],
    }),
    foreignKey({
      name: "fk_use_records_challenge",
      columns: [table.challengeId],
      foreignColumns: [verificationChallenges.challengeId],
    }),
    unique("uq_use_records_challenge").on(table.challengeId),
    unique("uq_use_records_run_scope_nullifier").on(
      table.demoRunId,
      table.scopeHash,
      table.nullifierKey
    ),
    unique("uq_use_records_run_scope_operation").on(
      table.demoRunId,
      table.scopeHash,
      table.operationId
    ),
    unique("uq_use_records_action_key").on(table.actionKey),
    index("ix_use_records_status_created").on(table.status, table.createdAt),
    check("ck_use_records_scope_hash", sql`${table.scopeHash} ~ '^sha256:[a-f0-9]{64}$'`),
    check(
      "ck_use_records_nullifier_key",
      sql`${table.nullifierKey} ~ '^hmac-sha256:[a-f0-9]{64}$'`
    ),
    check("ck_use_records_intent_digest", sql`${table.intentDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    check("ck_use_records_action_key", sql`${table.actionKey} ~ '^hmac-sha256:[a-f0-9]{64}$'`),
    check(
      "ck_use_records_status",
      sql`${table.status} IN ('ACCEPTED_PENDING_ACTION', 'SUCCEEDED', 'FAILED_FINAL')`
    ),
    check(
      "ck_use_records_failure_code",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} IN ('ACTION_FAILED_FINAL', 'ACTION_INTEGRITY_CONFLICT')`
    ),
    check(
      "ck_use_records_result_state",
      sql`(
        (${table.status} = 'ACCEPTED_PENDING_ACTION' AND ${table.cachedResult} IS NULL AND ${table.failureCode} IS NULL AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'SUCCEEDED' AND jsonb_typeof(${table.cachedResult}) = 'object' AND ${table.failureCode} IS NULL AND ${table.completedAt} IS NOT NULL)
        OR (${table.status} = 'FAILED_FINAL' AND jsonb_typeof(${table.cachedResult}) = 'object' AND ${table.failureCode} IS NOT NULL AND ${table.completedAt} IS NOT NULL)
      )`
    ),
  ]
);

export interface SafeOutboxPayload {
  readonly type: "REDEEM_DEMO_BENEFIT";
  readonly payload: { readonly benefitCode: "HACKATHON" | "WORKSHOP" };
}

export const outboxEvents = verifierSchema.table(
  "outbox_events",
  {
    eventId: uuid("event_id").primaryKey(),
    useId: uuid("use_id").notNull(),
    eventType: text("event_type").notNull(),
    actionKey: varchar("action_key", { length: 76 }).notNull(),
    payloadDigest: varchar("payload_digest", { length: 71 }).notNull(),
    safePayload: jsonb("safe_payload").$type<SafeOutboxPayload>().notNull(),
    state: text("state").default("READY").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "string" }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      name: "fk_outbox_events_use",
      columns: [table.useId],
      foreignColumns: [useRecords.useId],
    }),
    unique("uq_outbox_events_use_type").on(table.useId, table.eventType),
    index("ix_outbox_events_claim").on(table.state, table.nextAttemptAt, table.createdAt),
    check("ck_outbox_events_type", sql`${table.eventType} = 'COMMIT_DEMO_ACTION'`),
    check("ck_outbox_events_action_key", sql`${table.actionKey} ~ '^hmac-sha256:[a-f0-9]{64}$'`),
    check("ck_outbox_events_payload_digest", sql`${table.payloadDigest} ~ '^sha256:[a-f0-9]{64}$'`),
    check("ck_outbox_events_payload", sql`jsonb_typeof(${table.safePayload}) = 'object'`),
    check(
      "ck_outbox_events_state",
      sql`${table.state} IN ('READY', 'LEASED', 'DELIVERED', 'DEAD_LETTER')`
    ),
    check("ck_outbox_events_attempt_count", sql`${table.attemptCount} >= 0`),
    check(
      "ck_outbox_events_delivery_state",
      sql`(
        (${table.state} = 'READY' AND ${table.leaseUntil} IS NULL AND ${table.deliveredAt} IS NULL)
        OR (${table.state} = 'LEASED' AND ${table.leaseUntil} IS NOT NULL AND ${table.deliveredAt} IS NULL)
        OR (${table.state} = 'DELIVERED' AND ${table.leaseUntil} IS NULL AND ${table.deliveredAt} IS NOT NULL)
        OR (${table.state} = 'DEAD_LETTER' AND ${table.leaseUntil} IS NULL AND ${table.deliveredAt} IS NULL)
      )`
    ),
  ]
);

export const protocolEvents = verifierSchema.table(
  "protocol_events",
  {
    sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    eventId: uuid("event_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    eventName: text("event_name").notNull(),
    traceId: uuid("trace_id").notNull(),
    demoRunId: uuid("demo_run_id").notNull(),
    policyId: varchar("policy_id", { length: 128 }).notNull(),
    policyVersion: integer("policy_version").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    decisionCode: text("decision_code"),
    usageDelta: integer("usage_delta").notNull(),
    actionDelta: integer("action_delta").notNull(),
    latencyMs: integer("latency_ms"),
    maskedUseRef: varchar("masked_use_ref", { length: 16 }),
  },
  (table) => [
    foreignKey({
      name: "fk_protocol_events_run",
      columns: [table.demoRunId],
      foreignColumns: [demoRuns.demoRunId],
    }),
    foreignKey({
      name: "fk_protocol_events_policy",
      columns: [table.policyId, table.policyVersion],
      foreignColumns: [quotaPolicies.policyId, quotaPolicies.version],
    }),
    unique("uq_protocol_events_event_id").on(table.eventId),
    index("ix_protocol_events_run_sequence").on(table.demoRunId, table.sequence),
    check(
      "ck_protocol_events_name",
      sql`${table.eventName} IN (
        'CREDENTIAL_ISSUED', 'PRESENTATION_RECEIVED', 'PROOF_ACCEPTED', 'USE_ACCEPTED',
        'ACTION_DISPATCH_STARTED', 'EXTERNAL_ACTION_COMMITTED', 'RECEIPT_STORED',
        'ACK_DROPPED', 'RETRY_MATCHED', 'CACHED_RECEIPT_RETURNED', 'NULLIFIER_CONFLICT',
        'OVER_LIMIT_REJECTED', 'PRIVACY_AUDIT_COMPLETED', 'RETRY_IN_PROGRESS',
        'RETRY_RESOLVED', 'PRESENTATION_REJECTED', 'USE_FAILED_FINAL', 'DEMO_RESET'
      )`
    ),
    check(
      "ck_protocol_events_state",
      sql`(
        (${table.fromState} IS NULL OR ${table.fromState} IN ('UNSEEN', 'REJECTED', 'ACCEPTED_PENDING_ACTION', 'SUCCEEDED', 'FAILED_FINAL'))
        AND (${table.toState} IS NULL OR ${table.toState} IN ('UNSEEN', 'REJECTED', 'ACCEPTED_PENDING_ACTION', 'SUCCEEDED', 'FAILED_FINAL'))
      )`
    ),
    check(
      "ck_protocol_events_deltas",
      sql`${table.usageDelta} IN (0, 1) AND ${table.actionDelta} IN (0, 1)`
    ),
    check(
      "ck_protocol_events_latency",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} BETWEEN 0 AND 86400000`
    ),
    check(
      "ck_protocol_events_masked_ref",
      sql`${table.maskedUseRef} IS NULL OR ${table.maskedUseRef} ~ '^use_[a-f0-9]{12}$'`
    ),
  ]
);

export const demoFaults = verifierSchema.table(
  "demo_faults",
  {
    faultName: varchar("fault_name", { length: 64 }).primaryKey(),
    enabled: boolean("enabled").default(false).notNull(),
    oneShot: boolean("one_shot").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "ck_demo_faults_name",
      sql`${table.faultName} IN ('DROP_NEXT_ACK', 'FAIL_NEXT_ACTION', 'CRASH_NEXT_WORKER')`
    ),
  ]
);
