import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool as PgPool, PoolConfig } from "pg";
import { runMigrations } from "../../packages/db/src/migrations.js";

const requireFromDatabasePackage = createRequire(resolve("packages/db/package.json"));
const { Pool } = requireFromDatabasePackage("pg") as {
  readonly Pool: new (config?: PoolConfig) => PgPool;
};

const DATABASE = "anonlimit_phase3";
const OWNER = "migration_owner";
const OWNER_PASSWORD = "phase3-owner-password";

export const PHASE3_DATABASE_CREDENTIALS = Object.freeze({
  verifier_api: "phase3-api-password",
  verifier_worker: "phase3-worker-password",
  action_service: "phase3-action-password",
});

export interface Phase3Postgres {
  readonly container: StartedPostgreSqlContainer;
  readonly ownerConnectionString: string;
  readonly pool: PgPool;
  connectionStringFor(role: keyof typeof PHASE3_DATABASE_CREDENTIALS): string;
  migrate(): Promise<void>;
  stop(): Promise<void>;
}

function roleConnectionString(
  container: StartedPostgreSqlContainer,
  role: keyof typeof PHASE3_DATABASE_CREDENTIALS
): string {
  const url = new URL(container.getConnectionUri());
  url.username = role;
  url.password = PHASE3_DATABASE_CREDENTIALS[role];
  return url.toString();
}

export async function startPhase3Postgres(): Promise<Phase3Postgres> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase(DATABASE)
    .withUsername(OWNER)
    .withPassword(OWNER_PASSWORD)
    .withStartupTimeout(120_000)
    .start();
  const ownerConnectionString = container.getConnectionUri();
  const pool = new Pool({
    connectionString: ownerConnectionString,
    max: 12,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });

  try {
    const version = await pool.query<{ major: number }>(
      "SELECT current_setting('server_version_num')::int / 10000 AS major"
    );
    if (version.rows[0]?.major !== 17) throw new Error("POSTGRES_17_REQUIRED");
  } catch (error) {
    await pool.end();
    await container.stop();
    throw error;
  }

  return {
    container,
    ownerConnectionString,
    pool,
    connectionStringFor: (role) => roleConnectionString(container, role),
    migrate: () =>
      runMigrations(
        ownerConnectionString,
        resolve("packages/db/migrations"),
        {
          api: PHASE3_DATABASE_CREDENTIALS.verifier_api,
          worker: PHASE3_DATABASE_CREDENTIALS.verifier_worker,
          action: PHASE3_DATABASE_CREDENTIALS.action_service,
        },
        resolve("infra/postgres/00-create-schemas-and-roles.sql")
      ),
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
