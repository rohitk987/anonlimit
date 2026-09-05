import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMigrations } from "../../packages/db/src/migrations.js";
import { seedDefaultPolicy } from "../../packages/db/src/seed.js";
import {
  PHASE3_DATABASE_CREDENTIALS,
  startPhase3Postgres,
  type Phase3Postgres,
} from "../helpers/phase3-postgres.js";
import { PHASE3_NOW } from "../helpers/phase3-protocol.js";

interface UniqueConstraint {
  readonly constraint_name: string;
  readonly definition: string;
}

function databaseFailure(error: unknown): { readonly code: unknown; readonly constraint: unknown } {
  if (!error || typeof error !== "object") return { code: undefined, constraint: undefined };
  return {
    code: Reflect.get(error, "code"),
    constraint: Reflect.get(error, "constraint"),
  };
}

describe.sequential("Phase 3 PostgreSQL foundation", () => {
  let database: Phase3Postgres | undefined;

  beforeAll(async () => {
    database = await startPhase3Postgres();
    await database.migrate();
    await database.migrate();
  }, 120_000);

  afterAll(async () => {
    await database?.stop();
  }, 30_000);

  it("applies every migration to an empty PostgreSQL 17 database and reruns without drift", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const version = await database.pool.query<{ major: number }>(
      "SELECT current_setting('server_version_num')::int / 10000 AS major"
    );
    const migrations = await database.pool.query<{ name: string }>(
      "SELECT name FROM public.schema_migrations ORDER BY name"
    );

    expect(version.rows[0]?.major).toBe(17);
    expect(migrations.rows.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "bootstrap.sql",
        "action/0001-action-foundation.sql",
        "verifier/0001-durable-acceptance.sql",
      ])
    );
  });

  it("rejects late lower-numbered migrations and reused migration versions", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const databaseName = "anonlimit_phase3_migration_order";
    const directory = await mkdtemp(join(tmpdir(), "anonlimit-migrations-"));
    const verifierDirectory = join(directory, "verifier");
    const actionDirectory = join(directory, "action");
    const connectionUrl = new URL(database.ownerConnectionString);
    connectionUrl.pathname = `/${databaseName}`;
    const rolePasswords = {
      api: PHASE3_DATABASE_CREDENTIALS.verifier_api,
      worker: PHASE3_DATABASE_CREDENTIALS.verifier_worker,
      action: PHASE3_DATABASE_CREDENTIALS.action_service,
    };

    await database.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await database.pool.query(`CREATE DATABASE ${databaseName}`);
    try {
      await Promise.all([mkdir(verifierDirectory), mkdir(actionDirectory)]);
      const bootstrapFile = resolve("infra/postgres/00-create-schemas-and-roles.sql");
      await writeFile(
        join(verifierDirectory, "0002-applied.sql"),
        "CREATE TABLE verifier.migration_order_probe (id integer PRIMARY KEY);\n"
      );
      await runMigrations(connectionUrl.toString(), directory, rolePasswords, bootstrapFile);

      await writeFile(
        join(verifierDirectory, "0001-late.sql"),
        "CREATE TABLE verifier.late_probe (id integer PRIMARY KEY);\n"
      );
      await expect(
        runMigrations(connectionUrl.toString(), directory, rolePasswords, bootstrapFile)
      ).rejects.toThrow("MIGRATION_ORDER_INVALID");

      await unlink(join(verifierDirectory, "0001-late.sql"));
      await writeFile(
        join(verifierDirectory, "0002-reused.sql"),
        "CREATE TABLE verifier.reused_probe (id integer PRIMARY KEY);\n"
      );
      await expect(
        runMigrations(connectionUrl.toString(), directory, rolePasswords, bootstrapFile)
      ).rejects.toThrow("MIGRATION_VERSION_CONFLICT");
    } finally {
      await database.pool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("seeds the default policy twice without changing its immutable row", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const first = await seedDefaultPolicy(database.ownerConnectionString, {
      issuerKeyId: "demo-issuer-v1",
      now: () => PHASE3_NOW,
    });
    const before = await database.pool.query<{ snapshot: unknown }>(
      `
      SELECT jsonb_build_object(
        'run', (SELECT to_jsonb(r) FROM verifier.demo_runs r WHERE demo_run_id = $1),
        'policy', (SELECT to_jsonb(p) FROM verifier.quota_policies p
                   WHERE policy_id = $2 AND version = $3)
      ) AS snapshot
    `,
      [first.demoRunId, first.policy.id, first.policy.version]
    );
    const second = await seedDefaultPolicy(database.ownerConnectionString, {
      issuerKeyId: "demo-issuer-v1",
      now: () => PHASE3_NOW + 60_000,
    });
    const after = await database.pool.query<{ snapshot: unknown }>(
      `
      SELECT jsonb_build_object(
        'run', (SELECT to_jsonb(r) FROM verifier.demo_runs r WHERE demo_run_id = $1),
        'policy', (SELECT to_jsonb(p) FROM verifier.quota_policies p
                   WHERE policy_id = $2 AND version = $3)
      ) AS snapshot
    `,
      [second.demoRunId, second.policy.id, second.policy.version]
    );

    expect(second).toEqual(first);
    expect(after.rows[0]?.snapshot).toEqual(before.rows[0]?.snapshot);
  });

  it("installs the four authoritative acceptance uniqueness constraints", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const constraints = await database.pool.query<UniqueConstraint>(`
      SELECT conname AS constraint_name, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = 'verifier'::regnamespace
        AND conname IN (
          'uq_use_records_run_scope_nullifier',
          'uq_use_records_run_scope_operation',
          'uq_use_records_action_key',
          'uq_outbox_events_use_type'
        )
      ORDER BY conname
    `);

    expect(constraints.rows).toEqual([
      {
        constraint_name: "uq_outbox_events_use_type",
        definition: "UNIQUE (use_id, event_type)",
      },
      {
        constraint_name: "uq_use_records_action_key",
        definition: "UNIQUE (action_key)",
      },
      {
        constraint_name: "uq_use_records_run_scope_nullifier",
        definition: "UNIQUE (demo_run_id, scope_hash, nullifier_key)",
      },
      {
        constraint_name: "uq_use_records_run_scope_operation",
        definition: "UNIQUE (demo_run_id, scope_hash, operation_id)",
      },
    ]);
  });

  it("has PostgreSQL enforce each acceptance uniqueness boundary", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const seeded = await seedDefaultPolicy(database.ownerConnectionString, {
      issuerKeyId: "demo-issuer-v1",
      now: () => PHASE3_NOW,
    });
    const client = await database.pool.connect();
    const digest = (character: string) => `sha256:${character.repeat(64)}`;
    const keyed = (character: string) => `hmac-sha256:${character.repeat(64)}`;
    const ids = {
      challenges: [410, 411, 412, 413].map(
        (ordinal) => `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
      ),
      uses: [510, 511, 512, 513].map(
        (ordinal) => `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
      ),
      operations: [610, 611, 612, 613].map(
        (ordinal) => `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
      ),
      events: [710, 711].map(
        (ordinal) => `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`
      ),
    };

    try {
      await client.query("BEGIN");
      const policy = await client.query<{ policy_digest: string }>(
        `SELECT policy_digest FROM verifier.quota_policies
         WHERE policy_id = $1 AND version = $2`,
        [seeded.policy.id, seeded.policy.version]
      );
      const policyDigest = policy.rows[0]?.policy_digest;
      if (!policyDigest) throw new Error("TEST_POLICY_UNAVAILABLE");
      for (const [index, challengeId] of ids.challenges.entries()) {
        await client.query(
          `INSERT INTO verifier.verification_challenges (
             challenge_id, demo_run_id, nonce_hash, policy_id, policy_version,
             operation_id, intent_digest, scope_hash, policy_digest, expires_at, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            challengeId,
            seeded.demoRunId,
            digest(String(6 + index)),
            seeded.policy.id,
            seeded.policy.version,
            ids.operations[index],
            digest(index === 0 ? "c" : String(index + 1)),
            digest("a"),
            policyDigest,
            "2030-01-01T00:00:00.000Z",
            "2026-09-05T18:00:00.000Z",
          ]
        );
      }
      await client.query(
        `INSERT INTO verifier.use_records (
           use_id, demo_run_id, challenge_id, scope_hash, nullifier_key,
           operation_id, intent_digest, status, action_key, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACCEPTED_PENDING_ACTION',$8,$9)`,
        [
          ids.uses[0],
          seeded.demoRunId,
          ids.challenges[0],
          digest("a"),
          keyed("b"),
          ids.operations[0],
          digest("c"),
          keyed("d"),
          "2026-09-05T18:00:00.000Z",
        ]
      );
      await client.query(
        `INSERT INTO verifier.outbox_events (
           event_id, use_id, event_type, action_key, payload_digest, safe_payload,
           state, attempt_count, next_attempt_at, created_at
         ) VALUES ($1,$2,'COMMIT_DEMO_ACTION',$3,$4,$5::jsonb,'READY',0,$6,$6)`,
        [
          ids.events[0],
          ids.uses[0],
          keyed("d"),
          digest("e"),
          JSON.stringify({ type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } }),
          "2026-09-05T18:00:00.000Z",
        ]
      );

      async function expectUniqueViolation(
        sql: string,
        values: readonly unknown[],
        constraint: string
      ): Promise<void> {
        await client.query("SAVEPOINT uniqueness_probe");
        let failure: unknown;
        try {
          await client.query(sql, [...values]);
        } catch (error) {
          failure = error;
        }
        await client.query("ROLLBACK TO SAVEPOINT uniqueness_probe");
        await client.query("RELEASE SAVEPOINT uniqueness_probe");
        expect(databaseFailure(failure)).toEqual({ code: "23505", constraint });
      }

      const duplicateUse = `
        INSERT INTO verifier.use_records (
          use_id, demo_run_id, challenge_id, scope_hash, nullifier_key,
          operation_id, intent_digest, status, action_key, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACCEPTED_PENDING_ACTION',$8,$9)
      `;
      await expectUniqueViolation(
        duplicateUse,
        [
          ids.uses[1],
          seeded.demoRunId,
          ids.challenges[1],
          digest("a"),
          keyed("b"),
          ids.operations[1],
          digest("2"),
          keyed("0"),
          "2026-09-05T18:00:00.000Z",
        ],
        "uq_use_records_run_scope_nullifier"
      );
      await expectUniqueViolation(
        duplicateUse,
        [
          ids.uses[2],
          seeded.demoRunId,
          ids.challenges[2],
          digest("a"),
          keyed("1"),
          ids.operations[0],
          digest("3"),
          keyed("2"),
          "2026-09-05T18:00:00.000Z",
        ],
        "uq_use_records_run_scope_operation"
      );
      await expectUniqueViolation(
        duplicateUse,
        [
          ids.uses[3],
          seeded.demoRunId,
          ids.challenges[3],
          digest("a"),
          keyed("4"),
          ids.operations[3],
          digest("4"),
          keyed("d"),
          "2026-09-05T18:00:00.000Z",
        ],
        "uq_use_records_action_key"
      );
      await expectUniqueViolation(
        `INSERT INTO verifier.outbox_events (
           event_id, use_id, event_type, action_key, payload_digest, safe_payload,
           state, attempt_count, next_attempt_at, created_at
         ) VALUES ($1,$2,'COMMIT_DEMO_ACTION',$3,$4,$5::jsonb,'READY',0,$6,$6)`,
        [
          ids.events[1],
          ids.uses[0],
          keyed("d"),
          digest("e"),
          JSON.stringify({ type: "REDEEM_DEMO_BENEFIT", payload: { benefitCode: "HACKATHON" } }),
          "2026-09-05T18:00:00.000Z",
        ],
        "uq_outbox_events_use_type"
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps API, worker, action, and evidence roles within their database boundaries", async () => {
    if (!database) throw new Error("TEST_DATABASE_UNAVAILABLE");
    const privileges = await database.pool.query<{
      api_verifier: boolean;
      api_action: boolean;
      worker_use: boolean;
      worker_outbox: boolean;
      worker_events: boolean;
      worker_policy: boolean;
      worker_challenge: boolean;
      action_action: boolean;
      action_verifier: boolean;
      evidence_raw: boolean;
    }>(`
      SELECT
        has_table_privilege('verifier_api', 'verifier.use_records', 'INSERT') AS api_verifier,
        has_table_privilege('verifier_api', 'action_sim.action_results', 'SELECT') AS api_action,
        has_table_privilege('verifier_worker', 'verifier.use_records', 'UPDATE') AS worker_use,
        has_table_privilege('verifier_worker', 'verifier.outbox_events', 'UPDATE') AS worker_outbox,
        has_table_privilege('verifier_worker', 'verifier.protocol_events', 'INSERT') AS worker_events,
        has_table_privilege('verifier_worker', 'verifier.quota_policies', 'INSERT') AS worker_policy,
        has_table_privilege('verifier_worker', 'verifier.verification_challenges', 'UPDATE') AS worker_challenge,
        has_table_privilege('action_service', 'action_sim.action_results', 'INSERT') AS action_action,
        has_table_privilege('action_service', 'verifier.use_records', 'SELECT') AS action_verifier,
        has_table_privilege('evidence_reader', 'verifier.use_records', 'SELECT') AS evidence_raw
    `);

    expect(privileges.rows[0]).toEqual({
      api_verifier: true,
      api_action: false,
      worker_use: true,
      worker_outbox: true,
      worker_events: true,
      worker_policy: false,
      worker_challenge: false,
      action_action: true,
      action_verifier: false,
      evidence_raw: false,
    });
  });
});
