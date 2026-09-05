import { sql } from "drizzle-orm/sql";
import { boolean } from "drizzle-orm/pg-core/columns/boolean";
import { jsonb } from "drizzle-orm/pg-core/columns/jsonb";
import { timestamp } from "drizzle-orm/pg-core/columns/timestamp";
import { uuid } from "drizzle-orm/pg-core/columns/uuid";
import { varchar } from "drizzle-orm/pg-core/columns/varchar";
import { check } from "drizzle-orm/pg-core/checks";
import { index } from "drizzle-orm/pg-core/indexes";
import { pgSchema } from "drizzle-orm/pg-core/schema";

export const actionSchema = pgSchema("action_sim");

export type StoredReceipt = Readonly<Record<string, unknown>>;

export const actionResults = actionSchema.table(
  "action_results",
  {
    actionKey: varchar("action_key", { length: 76 }).primaryKey(),
    demoRunId: uuid("demo_run_id").notNull(),
    payloadDigest: varchar("payload_digest", { length: 71 }).notNull(),
    receipt: jsonb("receipt").$type<StoredReceipt>().notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ix_action_results_run_committed").on(table.demoRunId, table.committedAt),
    check("ck_action_results_action_key", sql`${table.actionKey} ~ '^hmac-sha256:[a-f0-9]{64}$'`),
    check(
      "ck_action_results_payload_digest",
      sql`${table.payloadDigest} ~ '^sha256:[a-f0-9]{64}$'`
    ),
    check("ck_action_results_receipt", sql`jsonb_typeof(${table.receipt}) = 'object'`),
  ]
);

export const actionFaults = actionSchema.table(
  "action_faults",
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
      "ck_action_faults_name",
      sql`${table.faultName} IN ('FAIL_NEXT_ACTION', 'DELAY_NEXT_ACTION')`
    ),
  ]
);
