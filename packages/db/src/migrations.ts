import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MIGRATION_FILE = /^(\d+)[-_][a-z0-9-]+\.sql$/u;
const MIGRATION_SCHEMAS = ["verifier", "action"] as const;

export interface MigrationRolePasswords {
  readonly api: string;
  readonly worker: string;
  readonly action: string;
}

interface MigrationFile {
  readonly key: string;
  readonly name: string;
  readonly version: number;
  readonly sql: string;
  readonly digest: string;
}

interface AppliedMigration {
  readonly name: string;
  readonly digest: string;
}

function versionFrom(name: string): number {
  const match = MIGRATION_FILE.exec(name);
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("MIGRATION_NAME_INVALID");
  return version;
}

async function migrationFiles(directory: string, schema: string): Promise<MigrationFile[]> {
  const names = (await readdir(join(directory, schema))).filter((name) => name.endsWith(".sql"));
  const files = await Promise.all(
    names.map(async (name) => {
      const version = versionFrom(name);
      const sql = await readFile(join(directory, schema, name), "utf8");
      return {
        key: `${schema}/${name}`,
        name,
        version,
        sql,
        digest: createHash("sha256").update(sql).digest("hex"),
      };
    })
  );
  files.sort((left, right) => left.version - right.version || left.name.localeCompare(right.name));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index]?.version === files[index - 1]?.version)
      throw new Error("MIGRATION_VERSION_CONFLICT");
  }
  return files;
}

function unappliedMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[]
): readonly MigrationFile[] {
  const filesByKey = new Map(files.map((file) => [file.key, file]));
  for (const row of applied) {
    const file = filesByKey.get(row.name);
    if (!file || file.digest !== row.digest) throw new Error("MIGRATION_DRIFT");
  }
  const appliedKeys = new Set(applied.map(({ name }) => name));
  const maximumAppliedVersion = applied.reduce(
    (maximum, row) => Math.max(maximum, versionFrom(row.name.slice(row.name.indexOf("/") + 1))),
    0
  );
  const pending = files.filter((file) => !appliedKeys.has(file.key));
  if (pending.some(({ version }) => version <= maximumAppliedVersion))
    throw new Error("MIGRATION_ORDER_INVALID");
  return pending;
}

async function applyMigration(
  client: pg.Client,
  migration: Pick<MigrationFile, "key" | "sql" | "digest">
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query("INSERT INTO public.schema_migrations(name,digest) VALUES ($1,$2)", [
      migration.key,
      migration.digest,
    ]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("MIGRATION_FAILED");
  }
}

export async function runMigrations(
  connectionString: string,
  directory: string,
  rolePasswords: MigrationRolePasswords,
  bootstrapFile: string
): Promise<void> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 30000,
  });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(170024)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())"
    );
    await client.query(
      `SELECT set_config('anonlimit.api_db_password', $1, false),
              set_config('anonlimit.worker_db_password', $2, false),
              set_config('anonlimit.action_db_password', $3, false)`,
      [rolePasswords.api, rolePasswords.worker, rolePasswords.action]
    );

    const bootstrapSql = await readFile(bootstrapFile, "utf8");
    const bootstrap = {
      key: "bootstrap.sql",
      sql: bootstrapSql,
      digest: createHash("sha256").update(bootstrapSql).digest("hex"),
    };
    const priorBootstrap = await client.query<AppliedMigration>(
      "SELECT name, digest FROM public.schema_migrations WHERE name = $1",
      [bootstrap.key]
    );
    if (priorBootstrap.rows[0]?.digest !== undefined) {
      if (priorBootstrap.rows[0].digest !== bootstrap.digest) throw new Error("MIGRATION_DRIFT");
      await client.query("BEGIN");
      try {
        await client.query(bootstrap.sql);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
        throw new Error("MIGRATION_FAILED");
      }
    } else {
      await applyMigration(client, bootstrap);
    }

    for (const schema of MIGRATION_SCHEMAS) {
      const files = await migrationFiles(directory, schema);
      const applied = await client.query<AppliedMigration>(
        "SELECT name, digest FROM public.schema_migrations WHERE name LIKE $1 ORDER BY name",
        [`${schema}/%`]
      );
      for (const migration of unappliedMigrations(files, applied.rows)) {
        await applyMigration(client, migration);
      }
    }
  } finally {
    await client.end();
  }
}
